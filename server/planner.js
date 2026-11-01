import { add, zero, macros, micros, totals, shiftDate, upperLimits, portionStep } from './nutrition.js';
import { slots } from './catalog.js';
import { planningRulesFor, planningGroup, minimumPortions, mealRuleIssues } from './planning-rules.js';

const beamWidth = 512;
export const portionOptionsFor = (food, rules) => {
  const step = portionStep(food), minimum = rules ? minimumPortions(food, rules) : 0;
  const groupMinimum = rules?.requireGroups ? rules[`groupMinimum${planningGroup(food, rules)}`] || 0 : 0;
  const maximum = Math.max(2, minimum, groupMinimum);
  return Array.from({ length: Math.ceil(maximum / step) + 1 }, (_, i) => i * step).filter(n => n + 1e-9 >= minimum);
};

export function isAllowed(food, profile) {
  const excluded = new Set(profile.excluded);
  return !excluded.has(food.id) && !food.ingredients.some(i => excluded.has(i.foodId)) && !(profile.dairyFree && food.dairy);
}
function permissible(total, baseline) {
  return Object.entries(upperLimits).every(([k, limit]) => total[k] <= Math.max(limit, baseline[k]) + .001);
}
export function targetPenalty(actual,target,shortfallOnly=false) {
  const error=shortfallOnly?Math.max(0,1-actual/target):Math.abs(actual/target-1);
  // Four times the relative distance, not a raw difference in mg/g/kcal.
  // Cap extreme overages to keep even infeasible partial states finite.
  return Math.expm1(4*Math.min(error,12));
}
function dailyScore(total, target) {
  return macros.reduce((s, k) => {
    const weight = k === 'protein' ? 3 : k === 'calories' ? 2 : 1;
    return s - weight * targetPenalty(total[k],target[k]);
  }, 0);
}
function weekScore(total, target) {
  return micros.reduce((s, k) => s-targetPenalty(total[k],target[k]*7,true),0);
}
function dayAvailability(index,state,foods,start) {
  const date = shiftDate(start, index);
  const logs = state.logs.filter(l => l.date === date);
  const baseline = totals(logs, foods);
  const work = slots.filter(meal => state.attendance[index][meal] && !logs.some(l => l.meal === meal) && !(state.completedMeals || []).some(l => l.date === date && l.meal === meal)).map(meal => ({ meal,
    ids: [...new Set([...state.menu[index][meal], ...state.extras.filter(e => e.date === date && e.meal === meal).map(e => e.foodId)])]
      .filter(id => foods.has(id) && macros.every(k => Number.isFinite(foods.get(id).nutrients[k])) && isAllowed(foods.get(id), state.profile)) })).filter(w => w.ids.length);
  return {date,logs,baseline,work};
}
function dayCandidates(index, state, foods, target, start, cap) {
  const rules = planningRulesFor(state.profile);
  const {date,baseline,work}=dayAvailability(index,state,foods,start);
  let beam = [{ total: baseline, entries: [], preference: 0 }];
  const weights = { breakfast: .25, lunch: .35, dinner: .3, snacks: .1 };
  const weightSum = work.reduce((sum, w) => sum + weights[w.meal], 0);
  let completed = 0;
  for (const { meal, ids } of work) {
    for (let item = 0; item < ids.length; item++) {
      const id = ids[item], food = foods.get(id);
      const portionsOptions = portionOptionsFor(food,rules);
      const requiredGroups = rules.requireGroups ? ['A','B'].filter(group =>
        ids.slice(0,item+1).some(id => planningGroup(foods.get(id),rules) === group)
        && !ids.slice(item+1).some(id => planningGroup(foods.get(id),rules) === group)) : [];
      // Score partial states against progress through meal shares, reserving
      // room for later meals instead of filling the day at breakfast/lunch.
      const progress = (completed + weights[meal] * (item + 1) / ids.length) / weightSum;
      const partialTarget = Object.fromEntries(Object.keys(target).map(k => [k, Math.max(.001, baseline[k] + Math.max(0, target[k] - baseline[k]) * progress)]));
      const next = [];
      for (const candidate of beam) {
        for (const portions of portionsOptions) {
          const total = add(candidate.total, food.nutrients, portions);
          if (!permissible(total, baseline)) continue;
          const entries = portions ? [...candidate.entries, { foodId: id, portions, meal, date }] : candidate.entries;
          if (requiredGroups.some(group => rules[`groupMinimum${group}`] > 0 && !entries.some(e => e.meal === meal && planningGroup(foods.get(e.foodId),rules) === group && e.portions >= rules[`groupMinimum${group}`]))) continue;
          const preference = candidate.preference + (state.profile.preferred.includes(id) ? portions * .02 : 0);
          next.push({ total, entries, preference });
        }
      }
      if (!next.length) {
        const error = new Error(`${date} ${meal}: no candidate satisfies the minimum portions, group rules and nutrient upper limits. Adjust your planning rules or menu.`);
        error.status = 422;
        throw error;
      }
      // Keep a diverse beam by calorie/protein bins as well as best scores.
      const rank = c => dailyScore(c.total, partialTarget) - .6 * micros.reduce((s, k) => s+targetPenalty(c.total[k],partialTarget[k],true),0)/micros.length+c.preference;
      for (const c of next) c.rank = rank(c);
      next.sort((a, b) => b.rank - a.rank);
      // Reserve half the beam for diverse nutrient profiles, then fill with
      // the best remaining states. Small search spaces retain every state.
      const bins = new Map(), diverse = new Set();
      if (next.length > beamWidth) {
        // Keep nutrient specialists so a rare D/B12 source cannot disappear
        // solely because an intermediate macro score looks less attractive.
        for(const k of micros){
          let best,coverage=0;
          for(const c of next){const v=Math.min(1,c.total[k]/partialTarget[k]);if(v>coverage){best=c;coverage=v;}}
          if(best)diverse.add(best);
        }
        for (const c of next) {
          const key = `${Math.floor(c.total.calories / 20)}:${Math.floor(c.total.protein / 2)}:${Math.floor(c.total.vitaminA / 75)}:${Math.floor(c.total.calcium / 60)}:${Math.floor(c.total.vitaminD / .25)}:${Math.floor(c.total.b12 / .1)}`;
          const count = bins.get(key) || 0;
          if (count < 2) { diverse.add(c); bins.set(key, count + 1); }
          if (diverse.size >= beamWidth / 2) break;
        }
      }
      for (const c of next) { if (diverse.size >= beamWidth) break; diverse.add(c); }
      beam = [...diverse].sort((a, b) => b.rank - a.rank);
    }
    completed += weights[meal];
  }
  return beam.length ? beam : [{ total: baseline, entries: [], preference: 0 }];
}
export function generatePlan(state, foods, target, start) {
  const cap = state.profile.calorieCap || target.calories;
  const scoringTarget = { ...target, calories: cap };
  const candidates = Array.from({ length: 7 }, (_, i) => dayCandidates(i, state, foods, scoringTarget, start, cap));
  const localScore = c => dailyScore(c.total, scoringTarget) + c.preference;
  for (const list of candidates) list.sort((a, b) => localScore(b) - localScore(a));
  let selected, bestWeekScore = -Infinity;
  // Coordinate refinement chooses whole-day combinations against weekly totals.
  // Bounded beam search is approximate, not an exact multidimensional knapsack.
  // Deterministic restarts explore different combinations of daily candidates.
  for (let restart = 0; restart < 4; restart++) {
    const trial = candidates.map((list, day) => list[restart ? ((day + 1) * restart * 37) % list.length : 0]);
    for (let pass = 0; pass < 16; pass++) {
      let changed = false;
      for (let day = 0; day < 7; day++) {
        const others = trial.reduce((s, c, i) => i === day ? s : add(s, c.total), zero());
        let best = trial[day], bestScore = localScore(best) + 1.5 * weekScore(add(others, best.total), target);
        for (const c of candidates[day]) {
          const score = localScore(c) + 1.5 * weekScore(add(others, c.total), target);
          if (score > bestScore + 1e-10) { bestScore = score; best = c; }
        }
        if (trial[day] !== best) changed = true;
        trial[day] = best;
      }
      if (!changed) break;
    }
    const score = trial.reduce((s, c) => s + localScore(c), 0) + 1.5 * weekScore(trial.reduce((s, c) => add(s, c.total), zero()), target);
    if (score > bestWeekScore) { bestWeekScore = score; selected = trial; }
  }
  return {...summarizePlan(selected,state,foods,target,start,cap),availability:availabilityBounds(state,foods,target,start)};
}
export function availabilityBounds(state,foods,target,start) {
  let maximum=zero();
  const incomplete=new Set();
  for(let day=0;day<7;day++){
    const {logs,baseline,work}=dayAvailability(day,state,foods,start);
    maximum=add(maximum,baseline);
    for(const entry of logs)for(const k of micros)if(foods.get(entry.foodId)?.nutrients[k]===null)incomplete.add(k);
    for(const meal of work)for(const id of meal.ids){
      const food=foods.get(id);maximum=add(maximum,food.nutrients,2);
      for(const k of micros)if(food.nutrients[k]===null)incomplete.add(k);
    }
  }
  return {maximum,ignoresCalorieAndUpperLimits:true,
    unreachable:micros.filter(k=>!incomplete.has(k)&&maximum[k]<target[k]*7-.001)};
}
function summarizePlan(selected,state,foods,target,start,cap) {
  const weekly = selected.reduce((s, c) => add(s, c.total), zero());
  const entries=[...selected.flatMap(c=>c.entries),...state.logs.filter(l=>l.date>=start&&l.date<=shiftDate(start,6))];
  const noData=micros.filter(k=>entries.length>0&&entries.every(e=>foods.get(e.foodId)?.nutrients[k]===null));
  return { start, createdAt: new Date().toISOString(), calorieCap: cap, method: '512-candidate beam search + exponential target-gap penalties + multi-start weekly refinement (approximate)',
    objective:{formula:'expm1(4 × relative target error)',micronutrients:'shortfall only; no reward for excess'},
    days: selected.map((c, i) => ({ date: shiftDate(start, i), total: c.total, entries: c.entries,
      loggedMeals: [...new Set(state.logs.filter(l => l.date === shiftDate(start, i)).map(l => l.meal))],
      warnings: [...(state.menu ? dayAvailability(i,state,foods,start).work.flatMap(({meal,ids}) => mealRuleIssues(c.entries.filter(e=>e.meal===meal),ids,foods,planningRulesFor(state.profile)).map(issue=>`${meal}: ${issue}`)) : []),c.total.calories < target.calories * .8 ? 'Available meals fall short of estimated energy needs.' : null,
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
  const preference = strategy.days.flatMap(day=>day.entries).reduce((sum,e)=>sum+(profile.preferred?.includes(e.foodId)?e.portions*.02:0),0);
  const objectiveScore = daily.reduce((sum, day) => sum + dailyScore(day,scoringTarget),0) + 1.5 * weekScore(weekly,target) + preference;
  const weight = 7 * 7 + 1.5 * micros.length;
  const entries = strategy.days.flatMap(day=>day.entries).filter(e=>e.portions>0);
  const incomplete = Object.keys(target).filter(k=>entries.some(e=>foods.get(e.foodId)?.nutrients[k]==null||foods.get(e.foodId)?.partialNutrients?.includes(k)));
  const overrides = strategy.days.flatMap((day,i)=>slots.flatMap(meal=>{
    const selected = day.entries.filter(e=>e.meal===meal);
    if (state && !state.attendance[i][meal] && !selected.length) return [];
    const available = [...new Set([...(state?.menu[i][meal]||[]),...selected.map(e=>e.foodId)])].filter(id=>foods.has(id)&&isAllowed(foods.get(id),profile));
    return mealRuleIssues(selected,available,foods,rules).map(message=>({day:i,meal,message}));
  }));
  return { value: Math.round(1000 / (1 + Math.max(0,-objectiveScore) / weight)) / 10, objectiveScore, incomplete, overrides,
    method: 'Daily macro fit plus weekly nutrient shortfalls; higher is better. Rule overrides are reported separately.' };
}
