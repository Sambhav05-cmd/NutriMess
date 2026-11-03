import { gaussianPenalty } from './parameters.js';

// Depth-first branch-and-bound over every food/meal/day decision. Bounds are
// optimistic, so only infeasible branches or branches unable to beat the best
// complete plan are skipped. No beam, daily-candidate truncation or restarts.
export function exhaustiveSearch({ prepared, keys, macroKeys, microKeys, limitIndices,
  target, scoringTarget, initial, maxNodes = Infinity, onProgress = () => {} }) {
  if (!(maxNodes === Infinity || Number.isSafeInteger(maxNodes) && maxNodes > 0))
    throw new Error('maxNodes must be a positive safe integer or Infinity.');
  const macroIndices = macroKeys.map(key => keys.indexOf(key));
  const microIndices = microKeys.map(key => keys.indexOf(key));
  const decisions = prepared.flatMap((day, d) => day.meals.flatMap((meal, m) =>
    meal.items.map((item, i) => ({ ...item, day: d, meal: m, required: meal.required,
      last: i === meal.items.length - 1 }))));
  const baseline = prepared.map(day => keys.map(key => day.baseline[key] || 0));
  const current = baseline.map(day => [...day]);
  const entries = prepared.map(() => []), masks = prepared.map(day => day.meals.map(() => 0));
  // Suffix bounds include mandatory minima and optimistic attainable maxima.
  const suffixMin = Array.from({length: decisions.length + 1}, () => baseline.map(() => keys.map(() => 0)));
  const suffixMax = suffixMin.map(days => days.map(day => [...day]));
  for (let i = decisions.length - 1; i >= 0; i--) {
    for (let d = 0; d < prepared.length; d++) {
      suffixMin[i][d] = [...suffixMin[i+1][d]];
      suffixMax[i][d] = [...suffixMax[i+1][d]];
    }
    const item = decisions[i];
    for (let k = 0; k < keys.length; k++) {
      suffixMin[i][item.day][k] += Math.min(...item.options.map(o => o.total[k]));
      suffixMax[i][item.day][k] += Math.max(...item.options.map(o => o.total[k]));
    }
  }
  function objective(days) {
    let score = 0;
    for (const day of days) for (const k of macroIndices)
      score -= gaussianPenalty(day[k], scoringTarget[keys[k]], keys[k]);
    for (const k of microIndices) score -= gaussianPenalty(days.reduce((s, day) => s + day[k], 0), target[keys[k]] * 7, keys[k]);
    return score;
  }
  function optimistic(index) {
    let score = 0;
    for (let d = 0; d < prepared.length; d++) for (const k of macroIndices) {
      const actual = current[d][k] + (keys[k] === 'calories' ? suffixMin[index][d][k] : suffixMax[index][d][k]);
      score -= gaussianPenalty(actual, scoringTarget[keys[k]], keys[k]);
    }
    for (const k of microIndices) score -= gaussianPenalty(current.reduce((s, day, d) => s + day[k] + suffixMax[index][d][k], 0), target[keys[k]] * 7, keys[k]);
    return score;
  }
  let best = initial.map(day => ({ entries: day.entries.map(e => ({...e})), total: keys.map(key => day.total[key] || 0) }));
  let bestScore = objective(best.map(day => day.total));
  let nodes = 0, leaves = 0, boundPrunes = 0, infeasiblePrunes = 0, stopped = false;
  let lastReport = performance.now();
  function visit(index) {
    if (nodes >= maxNodes) { stopped = true; return; }
    nodes++;
    if (performance.now() - lastReport >= 1000) {
      onProgress({ nodes, leaves, bestLogScore: bestScore }); lastReport = performance.now();
    }
    // Floating-point margin makes pruning conservative near equal scores.
    if (optimistic(index) < bestScore - 1e-10) { boundPrunes++; return; }
    if (index === decisions.length) {
      leaves++;
      const score = objective(current);
      if (score > bestScore) {
        bestScore = score;
        best = current.map((total,d) => ({total:[...total], entries: entries[d].map(e => ({...e}))}));
      }
      return;
    }
    const item = decisions[index], d = item.day, m = item.meal, before = current[d], maskBefore = masks[d][m];
    // Trying the incumbent quantity first improves bounds; every option remains.
    const incumbentAmount = initial[d].entries.filter(e => e.foodId === item.id && e.meal === item.options[0].entry.meal).reduce((s,e) => s+e.portions,0);
    const options = [...item.options].sort((a,b) => Math.abs(a.portions-incumbentAmount)-Math.abs(b.portions-incumbentAmount));
    for (const option of options) {
      const mask = maskBefore | option.group;
      const missing = item.required & ~mask;
      if (((mask | item.remainingGroups) & item.required) !== item.required || item.last && missing) { infeasiblePrunes++; continue; }
      const total = before.map((value,k) => value + option.total[k]);
      if (limitIndices.some((k,j) => total[k] + item.lower[j] + (missing & 1 ? item.extraA[j] : 0) + (missing & 2 ? item.extraB[j] : 0) > prepared[d].limits[j])) { infeasiblePrunes++; continue; }
      current[d] = total; masks[d][m] = mask;
      if (option.portions) entries[d].push({...option.entry});
      visit(index+1);
      if (option.portions) entries[d].pop();
      current[d] = before; masks[d][m] = maskBefore;
      if (stopped) break;
    }
  }
  visit(0);
  return {
    selected: best.map(day => ({entries:day.entries, total:Object.fromEntries(keys.map((key,k) => [key,day.total[k]]))})),
    search: { mode:'exact branch-and-bound', complete:!stopped, optimal:!stopped,
      nodes, leaves, boundPrunes, infeasiblePrunes, bestLogScore:bestScore,
      decisionCount:decisions.length,
      rawCombinations:decisions.reduce((n,item) => n * BigInt(item.options.length),1n).toString() }
  };
}
