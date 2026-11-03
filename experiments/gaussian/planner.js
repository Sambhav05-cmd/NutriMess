// Isolated snapshot of server/planner.js for the temporary Gaussian experiment.
// Dev mode selects this implementation. Search constraints are retained from the snapshot.
import { gaussianPenalty } from './parameters.js';
import { exhaustiveSearch } from './exhaustive.js';
import { add, zero, nutrients, macros, micros, totals, shiftDate, upperLimits, portionStep } from '../../server/nutrition.js';
import { slots } from '../../server/catalog.js';
import { planningRulesFor, planningGroup, minimumPortions, mealRuleIssues, dailyFoods, foodBoundsFor } from '../../server/planning-rules.js';

const beamWidth = 2048;
const nutrientKeys = Object.keys(nutrients);
const microIndices = micros.map(k => nutrientKeys.indexOf(k));
const macroIndices = macros.map(k => nutrientKeys.indexOf(k));
const limitIndices = Object.keys(upperLimits).map(k => nutrientKeys.indexOf(k));
const diversityBins = [['calories',20],['protein',2],['vitaminA',75],['calcium',60],['vitaminD',.25],['b12',.1]].map(([k,size]) => [nutrientKeys.indexOf(k),size]);
const vector = total => nutrientKeys.map(k => total[k] || 0);
const groupBit = group => group === 'A' ? 1 : group === 'B' ? 2 : 0;
export const portionOptionsFor = (food, rules, meal) => {
  const step=portionStep(food), bound=foodBoundsFor(food,rules,meal);
  const maximum=Math.min(5,bound?.max??5);
  const minimum=maximum===0?0:Math.max(bound?.min||0,rules?minimumPortions(food,rules):0);
  return Array.from({length:Math.floor(maximum/step)+1},(_,i)=>i*step).filter(n=>n+1e-9>=minimum);
};

export function isAllowed(food, profile, excluded = new Set(profile.excluded)) {
  return !excluded.has(food.id) && !food.ingredients.some(i => excluded.has(i.foodId)) && !(profile.dairyFree && food.dairy);
}
function dailyScore(total, target) {
  return macros.reduce((sum, key) => sum - gaussianPenalty(total[key], target[key], key), 0);
}
function weekScore(total, target) {
  return micros.reduce((sum, key) => sum - gaussianPenalty(total[key], target[key] * 7, key), 0);
}
function dayAvailability(index,state,foods,start,context = searchContext(state, foods)) {
  const eligible = id => !!context.foodRecord(id);
  const date = shiftDate(start, index);
  const logs = state.logs.filter(l => l.date === date);
  const baseline = totals(logs, foods);
  const openMeals = slots.filter(meal => state.attendance[index][meal] && !logs.some(l => l.meal === meal) && !(state.completedMeals || []).some(l => l.date === date && l.meal === meal));
  const work = openMeals.map(meal => ({ meal,
    ids: [...new Set([...state.menu[index][meal], ...state.extras.filter(e => e.date === date && e.meal === meal).map(e => e.foodId)])]
      .filter(eligible), fixed: new Map() }));
  const ruleWarnings = [];
  for (const daily of context.daily) {
    if (!daily.enabled) continue;
    const logged = logs.filter(e => daily.ids.includes(e.foodId)).reduce((sum, e) => sum + e.portions, 0);
    // One daily serving, rather than one serving at every offered meal.
    for (const w of work) for (const id of w.ids) if (daily.ids.includes(id) && !(foodBoundsFor(foods.get(id),context.rules,w.meal)?.min>0)) w.fixed.set(id, 0);
    if (logged >= 1) continue;
    if (!daily.foodId) {
      ruleWarnings.push(`Daily ${daily.label} default skipped: the food is excluded, unavailable or dairy-free is selected.`);
      continue;
    }
    const chosen = work.find(w => w.meal === daily.meal) || work[0];
    if (!chosen) {
      ruleWarnings.push(`Daily ${daily.label} default could not be added: no attended, unrecorded meal is available.`);
      continue;
    }
    const step = portionStep(foods.get(daily.foodId));
    const portions = Math.ceil((1 - logged) / step - 1e-9) * step;
    if (!chosen.ids.includes(daily.foodId)) chosen.ids.push(daily.foodId);
    const custom=foodBoundsFor(foods.get(daily.foodId),context.rules,chosen.meal);
    chosen.fixed.set(daily.foodId,custom?{min:Math.max(portions,custom.min)}:portions);
  }
  for (const w of work) w.ids = w.ids.filter(id => w.fixed.get(id) !== 0 && foodBoundsFor(foods.get(id),context.rules,w.meal)?.max !== 0);
  return {date,logs,baseline,work:work.filter(w => w.ids.length),ruleWarnings};
}
function searchContext(state, foods) {
  const rules = planningRulesFor(state.profile);
  const excluded = new Set(state.profile.excluded);
  const records = new Map();
  function foodRecord(id, meal) {
    const key=`${meal||'all'}:${id}`;
    if (records.has(key)) return records.get(key);
    const food = foods.get(id);
    let record = null;
    if (food && macros.every(k => Number.isFinite(food.nutrients[k])) && isAllowed(food, state.profile, excluded)) {
      const group = planningGroup(food, rules), bit = groupBit(group);
      const minimum = rules.requireGroups ? rules[`groupMinimum${group}`] || 0 : 0;
      const values = vector(food.nutrients);
      record = { bit, required: minimum > 0 ? bit : 0, options: portionOptionsFor(food, rules, meal).map(portions => {
        const total = values.map(value => value * portions);
        return { portions, total, upper: limitIndices.map(i => total[i]),
          group: minimum > 0 && portions >= minimum ? bit : 0,
          preference: 0 };
      }) };
    }
    records.set(key, record);
    return record;
  }
  const offered = new Set(state.menu.flatMap(day => slots.flatMap(meal => day[meal])));
  const daily = dailyFoods.map(spec => {
    const enabled = !!rules[spec.rule];
    const suppressed = state.profile.dairyFree || spec.ids.some(id => excluded.has(id));
    const candidates = [...spec.ids].sort((a,b) => Number(offered.has(b)) - Number(offered.has(a)));
    const foodId = !suppressed && enabled ? candidates.find(id => !!foodRecord(id)) : undefined;
    return { ...spec, enabled, foodId };
  });
  return { rules, foodRecord, daily, foods };
}
function infeasible(date, meal, reason) {
  const error = new Error(`${date} ${meal}: ${reason||'no candidate satisfies the minimum portions, group choices, food limits and nutrient upper limits. Adjust your planning rules or menu.'}`);
  error.conflict={date,meal,reason:reason||'The combined portion, group and nutrient limits cannot all be satisfied.'};
  error.status = 422;
  throw error;
}

// Compile admissible lower bounds before expanding a beam. Mandatory portions
// reserve nutrient budget for the rest of the day. Each unsatisfied group also
// reserves the cheapest extra contribution of a qualifying remaining dish.
// Bounds are per nutrient, so they can underestimate cost but never reject a
// feasible choice merely because different dishes supply different minima.
function prepareDay(available, context) {
  const { date, baseline, work } = available;
  const limits = Object.entries(upperLimits).map(([k, limit]) => Math.max(limit, baseline[k]) + .001);
  const base = limitIndices.map(i => baseline[nutrientKeys[i]] || 0);
  const meals = work.map(({ meal, ids, fixed }) => {
    let required = 0;
    const items = ids.map(id => {
      const record = context.foodRecord(id,meal);
      required |= record.required;
      const options = record.options.filter(option => (!fixed.has(id) || (typeof fixed.get(id)==='object'?option.portions>=fixed.get(id).min:fixed.get(id) === option.portions)) && option.upper.every((n, k) => base[k] + n <= limits[k]));
      if (!options.length) {
        const food=context.foods.get(id),bound=foodBoundsFor(food,context.rules,meal);
        infeasible(date,meal,`${food.originalMenuName||food.name} has no allowed quantity after its minimum (${Math.max(minimumPortions(food,context.rules),bound?.min||0)}), maximum (${bound?.max??5}), daily default and nutrient upper limits are applied. Adjust this food’s limits or the default.`);
      }
      return { id, bit:record.bit, options: options.map(option => ({ ...option, entry: { foodId: id, portions: option.portions, meal, date } })) };
    });
    return { meal, items, required };
  });
  let future = limits.map(() => 0);
  for (let m = meals.length - 1; m >= 0; m--) {
    const { meal, items, required } = meals[m];
    let mandatory = limits.map(() => 0), remainingGroups = 0;
    let extraA = limits.map(() => Infinity), extraB = limits.map(() => Infinity);
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i], minimum = item.options[0].upper;
      item.lower = mandatory.map((n, k) => n + future[k]);
      item.remainingGroups = remainingGroups;
      item.extraA = extraA.slice(); item.extraB = extraB.slice();
      for (const option of item.options) {
        if (!option.group) continue;
        remainingGroups |= option.group;
        const extra = option.group === 1 ? extraA : extraB;
        for (let k = 0; k < limits.length; k++) extra[k] = Math.min(extra[k], Math.max(0, option.upper[k] - minimum[k]));
      }
      mandatory = mandatory.map((n, k) => n + minimum[k]);
    }
    if ((remainingGroups & required) !== required) infeasible(date, meal);
    future = mandatory.map((n, k) => n + future[k] + (required & 1 ? extraA[k] : 0) + (required & 2 ? extraB[k] : 0));
    if (future.some((n, k) => base[k] + n > limits[k])) infeasible(date, meal);
  }
  return { ...available, meals, limits };
}
function dailyVectorScore(total, target) {
  return macroIndices.reduce((sum, i) => sum - gaussianPenalty(total[i], target[i], nutrientKeys[i]), 0);
}
function weeklyVectorScore(others, total, target) {
  return microIndices.reduce((sum, i) => sum - gaussianPenalty(others[i] + total[i], target[i] * 7, nutrientKeys[i]), 0);
}
function retainBeam(next, target, getTotal = c => c.total, scale = 1) {
  next.sort((a,b) => b.rank - a.rank);
  if (next.length <= beamWidth) return next;
  const bins = new Map(), diverse = new Set();
  for (const k of microIndices) {
    let best, coverage = 0;
    for (const c of next) {
      const value = Math.min(1, getTotal(c)[k] / target[k]);
      if (value > coverage) { best = c; coverage = value; }
    }
    if (best) diverse.add(best);
  }
  for (const c of next) {
    const total = getTotal(c);
    const key = diversityBins.map(([k,size]) => Math.floor(total[k] / (size * scale))).join(':');
    const count = bins.get(key) || 0;
    if (count < 2) { diverse.add(c); bins.set(key, count + 1); }
    if (diverse.size >= beamWidth / 2) break;
  }
  for (const c of next) { if (diverse.size >= beamWidth) break; diverse.add(c); }
  return [...diverse].sort((a,b) => b.rank - a.rank);
}

function dayCandidates(prepared, target) {
  const { baseline, meals, limits } = prepared;
  const base = vector(baseline);
  let beam = [{ total: base, tail: null, preference: 0, groupMask: 0 }];
  const weights = { breakfast: .25, lunch: .35, dinner: .3, snacks: .1 };
  const weightSum = meals.reduce((sum, w) => sum + weights[w.meal], 0);
  let completed = 0;
  for (const { meal, items, required } of meals) {
    beam = beam.map(candidate => ({ ...candidate, groupMask: 0 }));
    for (let item = 0; item < items.length; item++) {
      const { options, remainingGroups, lower, extraA, extraB } = items[item];
      // Score partial states against progress through meal shares, reserving
      // room for later meals instead of filling the day at breakfast/lunch.
      const progress = (completed + weights[meal] * (item + 1) / items.length) / weightSum;
      const partialTarget = target.map((n, k) => Math.max(.001, base[k] + Math.max(0, n - base[k]) * progress));
      const next = [];
      for (const candidate of beam) {
        for (const option of options) {
          const groupMask = candidate.groupMask | option.group;
          if (((groupMask | remainingGroups) & required) !== required) continue;
          const missing = required & ~groupMask;
          let feasible = true;
          for (let k = 0; k < limits.length; k++) {
            const reserved = lower[k] + (missing & 1 ? extraA[k] : 0) + (missing & 2 ? extraB[k] : 0);
            if (candidate.total[limitIndices[k]] + option.upper[k] + reserved > limits[k]) { feasible = false; break; }
          }
          if (!feasible) continue;
          const total = option.portions ? candidate.total.map((n, k) => n + option.total[k]) : candidate.total;
          const tail = option.portions ? { previous: candidate.tail, entry: option.entry } : candidate.tail;
          next.push({ total, tail, groupMask, preference: candidate.preference + option.preference });
        }
      }
      if (!next.length) infeasible(prepared.date, meal);
      // Keep a diverse beam by calorie/protein bins as well as best scores.
      const rank = c => dailyVectorScore(c.total, partialTarget) - .6 * microIndices.reduce((s, k) => s+gaussianPenalty(c.total[k],partialTarget[k],nutrientKeys[k]),0)/micros.length+c.preference;
      for (const c of next) c.rank = rank(c);
      beam = retainBeam(next, partialTarget);
    }
    completed += weights[meal];
  }
  return beam;
}
export function planningConflicts(state,foods,start) {
  const context=searchContext(state,foods),conflicts=[];
  for(let day=0;day<7;day++){
    const available=dayAvailability(day,state,foods,start,context);
    let hasConflict=false;
    for(const work of available.work)try{prepareDay({...available,work:[work]},context);}catch(error){
      if(error.status!==422)throw error;
      conflicts.push(error.conflict||{date:available.date,meal:work.meal,reason:error.message});hasConflict=true;
    }
    if(!hasConflict)try{prepareDay(available,context);}catch(error){
      if(error.status!==422)throw error;
      conflicts.push(error.conflict||{date:available.date,reason:error.message});
    }
  }
  return conflicts;
}

export function generatePlan(state, foods, target, start) {
  const cap = state.profile.calorieCap || target.calories;
  const scoringTarget = { ...target, calories: cap };
  const context = searchContext(state, foods), targetValues = vector(target), scoringValues = vector(scoringTarget);
  // Prepare every day before searching, so impossible hard rules fail early.
  const available = Array.from({ length: 7 }, (_, i) => dayAvailability(i, state, foods, start, context));
  const prepared = available.map(day => prepareDay(day, context));
  const candidates = prepared.map(day => dayCandidates(day, scoringValues));
  for (const list of candidates) {
    for (const c of list) c.localScore = dailyVectorScore(c.total, scoringValues) + c.preference;
    list.sort((a, b) => b.localScore - a.localScore);
  }
  let selected, bestWeekScore = -Infinity;
  // Coordinate refinement chooses whole-day combinations against weekly totals.
  // Bounded beam search is approximate, not an exact multidimensional knapsack.
  // Deterministic restarts explore different combinations of daily candidates.
  for (let restart = 0; restart < 4; restart++) {
    const trial = candidates.map((list, day) => list[restart ? ((day + 1) * restart * 37) % list.length : 0]);
    for (let pass = 0; pass < 16; pass++) {
      let changed = false;
      for (let day = 0; day < 7; day++) {
        const others = nutrientKeys.map(() => 0);
        for (let i = 0; i < trial.length; i++) if (i !== day) for (let k = 0; k < others.length; k++) others[k] += trial[i].total[k];
        let best = trial[day], bestScore = best.localScore + weeklyVectorScore(others, best.total, targetValues);
        for (const c of candidates[day]) {
          const score = c.localScore + weeklyVectorScore(others, c.total, targetValues);
          if (score > bestScore + 1e-10) { bestScore = score; best = c; }
        }
        if (trial[day] !== best) changed = true;
        trial[day] = best;
      }
      if (!changed) break;
    }
    const weekly = nutrientKeys.map(() => 0);
    for (const c of trial) for (let k = 0; k < weekly.length; k++) weekly[k] += c.total[k];
    const score = trial.reduce((s, c) => s + c.localScore, 0) + weeklyVectorScore(nutrientKeys.map(() => 0), weekly, targetValues);
    if (score > bestWeekScore) { bestWeekScore = score; selected = trial; }
  }
  selected = refinePortions(selected, prepared, scoringValues, targetValues);
  const days = selected.map(c => {
    const entries = [];
    for (let tail = c.tail; tail; tail = tail.previous) entries.push({ ...tail.entry });
    entries.reverse();
    return { entries, total: Object.fromEntries(nutrientKeys.map((k, i) => [k, c.total[i]])) };
  });
  return {...summarizePlan(days,state,foods,target,start,cap,available),availability:availabilityBounds(state,foods,target,start)};
}
// Optimize the actual full-week objective after beam selection. In particular,
// remove/reduce excess portions even when the beam discarded that combination.
function refinePortions(selected, prepared, scoringTarget, target) {
  const chosen = selected.map((candidate,d) => {
    const entries=[];
    for(let tail=candidate.tail;tail;tail=tail.previous) entries.push(tail.entry);
    return prepared[d].meals.map(meal => meal.items.map(item => {
      const amount=entries.filter(e=>e.foodId===item.id&&e.meal===meal.meal).reduce((sum,e)=>sum+e.portions,0);
      return item.options.find(option=>option.portions===amount);
    }));
  });
  const daily = selected.map(c=>[...c.total]);
  let weekly = nutrientKeys.map((_,k)=>daily.reduce((sum,total)=>sum+total[k],0));
  const microScore = total => microIndices.reduce((sum,k)=>sum-gaussianPenalty(Math.max(0,total[k]),target[k]*7,nutrientKeys[k]),0);
  for(let pass=0;pass<64;pass++) {
    let changed=false;
    for(let d=0;d<prepared.length;d++) for(let m=0;m<prepared[d].meals.length;m++) {
      const meal=prepared[d].meals[m];
      for(let i=0;i<meal.items.length;i++) {
        const current=chosen[d][m][i];
        let best=current, bestDaily=daily[d], bestWeekly=weekly;
        let bestScore=dailyVectorScore(daily[d],scoringTarget)+microScore(weekly);
        for(const option of meal.items[i].options) {
          if(option===current)continue;
          const mask=chosen[d][m].reduce((mask,o,j)=>mask|(j===i?option:o).group,0);
          if((mask&meal.required)!==meal.required)continue;
          const total=daily[d].map((n,k)=>Math.max(0,n+option.total[k]-current.total[k]));
          if(limitIndices.some((k,j)=>total[k]>prepared[d].limits[j]))continue;
          const week=weekly.map((n,k)=>Math.max(0,n+option.total[k]-current.total[k]));
          const score=dailyVectorScore(total,scoringTarget)+microScore(week);
          if(score>bestScore+1e-10){best=option;bestScore=score;bestDaily=total;bestWeekly=week;}
        }
        if(best!==current){chosen[d][m][i]=best;daily[d]=bestDaily;weekly=bestWeekly;changed=true;}
      }
    }
    if(!changed)break;
  }
  return daily.map((total,d)=>{
    let tail=null;
    for(const meal of chosen[d])for(const option of meal)if(option.portions)tail={previous:tail,entry:option.entry};
    return {total,tail};
  });
}
export function availabilityBounds(state,foods,target,start) {
  let maximum=zero();
  const incomplete=new Set();
  const context=searchContext(state,foods);
  for(let day=0;day<7;day++){
    const {logs,baseline,work}=dayAvailability(day,state,foods,start,context);
    maximum=add(maximum,baseline);
    for(const entry of logs)for(const k of micros)if(foods.get(entry.foodId)?.nutrients[k]===null)incomplete.add(k);
    for(const meal of work)for(const id of meal.ids){
      const food=foods.get(id), amount=meal.fixed.has(id)&&typeof meal.fixed.get(id)==='number'?meal.fixed.get(id):portionOptionsFor(food,context.rules,meal.meal).at(-1)??0;
      maximum=add(maximum,food.nutrients,amount);
      for(const k of micros)if(food.nutrients[k]===null)incomplete.add(k);
    }
  }
  return {maximum,ignoresCalorieAndUpperLimits:true,
    unreachable:micros.filter(k=>!incomplete.has(k)&&maximum[k]<target[k]*7-.001)};
}
function summarizePlan(selected,state,foods,target,start,cap,available) {
  const weekly = selected.reduce((s, c) => add(s, c.total), zero());
  const entries=[...selected.flatMap(c=>c.entries),...state.logs.filter(l=>l.date>=start&&l.date<=shiftDate(start,6))];
  const noData=micros.filter(k=>entries.length>0&&entries.every(e=>foods.get(e.foodId)?.nutrients[k]===null));
  return { start, createdAt: new Date().toISOString(), calorieCap: cap, method: 'EXPERIMENTAL: 2048-candidate beam search + normalized Gaussian log-score + multi-start weekly and per-food refinement (approximate)',
    objective:{formula:'log S = -sum(relative one-sided gap squared / (2 × normalized variance))',calories:'excess only; no reward or penalty at or below target',otherNutrients:'shortfall only; no reward or penalty for excess'},
    days: selected.map((c, i) => ({ date: shiftDate(start, i), total: c.total, entries: c.entries,
      loggedMeals: [...new Set(state.logs.filter(l => l.date === shiftDate(start, i)).map(l => l.meal))],
      warnings: [...(state.menu ? (available?.[i]||dayAvailability(i,state,foods,start)).work.flatMap(({meal,ids}) => mealRuleIssues(c.entries.filter(e=>e.meal===meal),ids,foods,planningRulesFor(state.profile),meal).map(issue=>`${meal}: ${issue}`)) : []),...(available?.[i]?.ruleWarnings||[]),c.total.calories < target.calories * .8 ? 'Available meals fall short of estimated energy needs.' : null,
        c.total.protein < target.protein * .9 ? 'Protein is below the planning target.' : null,
        c.total.calories > cap ? 'Calories exceed the planning target; this reduces the plan score.' : null,
        ...Object.entries(upperLimits).filter(([k, limit]) => c.total[k] > limit).map(([k]) => `Existing logged ${k} exceeds the general adult food-intake upper limit.`)].filter(Boolean) })),
    weekly, noData, estimated: micros.filter(k => entries.some(e => {const f=foods.get(e.foodId);return f?.nutritionModel&&f.nutrients[k]!==null&&(!f.fallbackNutrients||f.fallbackNutrients.includes(k));})),
    gaps: micros.filter(k => !noData.includes(k) && weekly[k] < target[k] * 7 * .9),
    unknown: micros.filter(k => entries.some(e => foods.get(e.foodId)?.nutrients[k] === null || foods.get(e.foodId)?.partialNutrients?.includes(k))),
    note: 'Weekly coverage is a planning heuristic, not permission to skip daily needs. Totals include logs; a logged meal is treated as complete. Unknown nutrients are unverified, not proven absent. Cooking can change values.' };
}

// Saved reusable plans store food IDs and portions. Recompute cached summaries
// against the shared catalog when its nutrient records change.
export function refreshPlanNutrition(plan,foods,target,state) {
  const selected=plan.days.map(d=>({entries:d.entries,total:totals(d.entries,foods)}));
  const summary=summarizePlan(selected,{...state,logs:[],completedMeals:[]},foods,target,plan.start,plan.calorieCap);
  return {...plan,...summary,...(state?{availability:availabilityBounds({...state,logs:[],completedMeals:[]},foods,target,plan.start)}:{}),method:plan.method,createdAt:plan.createdAt,nutritionUpdatedAt:new Date().toISOString()};
}

export function scoreStrategy(strategy, foods, target, profile, state) {
  const rules = planningRulesFor(profile), scoringTarget = { ...target, calories: profile.calorieCap || target.calories };
  const daily = strategy.days.map(day => totals(day.entries, foods));
  const weekly = daily.reduce((sum, day) => add(sum, day), zero());
  const objectiveScore = daily.reduce((sum, day) => sum + dailyScore(day,scoringTarget),0) + weekScore(weekly,target);
  const entries = strategy.days.flatMap(day=>day.entries).filter(e=>e.portions>0);
  const incomplete = Object.keys(target).filter(k=>entries.some(e=>foods.get(e.foodId)?.nutrients[k]==null||foods.get(e.foodId)?.partialNutrients?.includes(k)));
  const overrides = strategy.days.flatMap((day,i)=>slots.flatMap(meal=>{
    const selected = day.entries.filter(e=>e.meal===meal);
    if (state && !state.attendance[i][meal] && !selected.length) return [];
    const available = [...new Set([...(state?.menu[i][meal]||[]),...selected.map(e=>e.foodId)])].filter(id=>foods.has(id)&&isAllowed(foods.get(id),profile));
    return mealRuleIssues(selected,available,foods,rules,meal).map(message=>({day:i,meal,message}));
  }));
  for (let day=0; day<strategy.days.length; day++) for (const spec of dailyFoods) {
    if (!rules[spec.rule] || profile.dairyFree || spec.ids.some(id=>profile.excluded?.includes(id))) continue;
    if (!spec.ids.some(id=>foods.has(id)&&isAllowed(foods.get(id),profile))) continue;
    const portions=strategy.days[day].entries.filter(e=>spec.ids.includes(e.foodId)).reduce((sum,e)=>sum+e.portions,0);
    if (Math.abs(portions-1)>1e-9) overrides.push({day,meal:spec.meal,message:`Daily ${spec.label}: choose one listed serving per day.`});
  }
  if (rules.consistentPortions) {
    const common=new Map();
    strategy.days.forEach((day,i)=>slots.forEach(meal=>{
      const selected=day.entries.filter(e=>e.meal===meal);
      if (state && !state.attendance[i][meal] && !selected.length) return;
      const available=new Set([...(state?.menu[i][meal]||[]),...selected.map(e=>e.foodId)]);
      for (const id of available) {
        if (!foods.has(id)||!isAllowed(foods.get(id),profile)) continue;
        const amount=selected.filter(e=>e.foodId===id).reduce((sum,e)=>sum+e.portions,0),key=`${meal}:${id}`;
        if (!common.has(key)) common.set(key,amount);
        else if (Math.abs(common.get(key)-amount)>1e-9) overrides.push({day:i,meal,message:`${foods.get(id).name}: use the same portions at ${meal} across days.`});
      }
    }));
  }
  return { value: 100 * Math.exp(objectiveScore), logScore: objectiveScore, objectiveScore, experimental: true, incomplete, overrides,
    method: 'Experimental normalized Gaussian product: daily macro shortfalls, excess-only calories and weekly fiber/micronutrient shortfalls. Heuristic variances; no favorites bonus. Rank by logScore.' };
}

// Explicit offline exact search; never blocks the normal HTTP request handler.
export function generateExhaustivePlan(state, foods, target, start, options = {}) {
  const cap = state.profile.calorieCap || target.calories;
  const context = searchContext(state, foods);
  const available = Array.from({length:7}, (_,i) => dayAvailability(i,state,foods,start,context));
  const prepared = available.map(day => prepareDay(day,context));
  const initial = generatePlan(state,foods,target,start);
  const {selected, search} = exhaustiveSearch({prepared, keys:nutrientKeys, macroKeys:macros,
    microKeys:micros, limitIndices, target, scoringTarget:{...target,calories:cap}, initial:initial.days, ...options});
  return {...summarizePlan(selected,state,foods,target,start,cap,available),
    method: search.complete ? 'Exact exhaustive branch-and-bound (optimal within configured portion choices)' : 'Interrupted exact search (optimality not proven)',
    search, availability:availabilityBounds(state,foods,target,start)};
}
export function exhaustiveSearchSize(state, foods, start) {
  const context=searchContext(state,foods);
  const daily=Array.from({length:7}, (_,i) => prepareDay(dayAvailability(i,state,foods,start,context),context))
    .map(day => day.meals.flatMap(meal=>meal.items).reduce((n,item)=>n*BigInt(item.options.length),1n));
  return {daily:daily.map(String), weekly:daily.reduce((a,b)=>a*b,1n).toString()};
}
