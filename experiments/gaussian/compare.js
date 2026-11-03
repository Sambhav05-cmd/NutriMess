import { performance } from 'node:perf_hooks';
import { generatePlan as mainPlan, scoreStrategy as mainScore } from '../../server/planner.js';
import { generatePlan, scoreStrategy } from './planner.js';
import { foods, messMenuPreset } from '../../server/catalog.js';
import { newStudent } from '../../server/accounts.js';
import { targets, nutrients, micros, upperLimits } from '../../server/nutrition.js';
import { variances } from './parameters.js';

const results = {};
for (const menu of ['sample', 'nitk']) {
  const state = newStudent();
  if (menu === 'nitk') state.menu = structuredClone(messMenuPreset.menu);
  const target = targets(state.profile);
  results[menu] = {};
  for (const [name, generate] of [['main', mainPlan], ['gaussian', generatePlan]]) {
    const began = performance.now();
    const plan = generate(structuredClone(state), foods, target, '2026-11-02');
    const elapsedMs = performance.now() - began;
    const experimental = scoreStrategy(plan, foods, target, state.profile, state);
    results[menu][name] = {
      elapsedMs, mainScore: mainScore(plan, foods, target, state.profile, state).value,
      gaussianScore: experimental.value, gaussianLogScore: experimental.logScore,
      incomplete: experimental.incomplete, ruleOverrides: experimental.overrides.length,
      entries: plan.days.reduce((sum, day) => sum + day.entries.length, 0),
      calorieTarget: state.profile.calorieCap || target.calories,
      dailyCalories: plan.days.map(day => day.total.calories),
      maxCalorieExcessPercent: Math.max(0, ...plan.days.map(day =>
        100 * (day.total.calories / (state.profile.calorieCap || target.calories) - 1))),
      weeklyCoverage: Object.fromEntries(Object.keys(nutrients).map(key => [key,
        plan.days.reduce((sum, day) => sum + day.total[key], 0) / (7 * target[key])])),
      dailyUpperLimitViolations: plan.days.flatMap((day, i) =>
        Object.entries(upperLimits).filter(([key, limit]) => day.total[key] > limit + 1e-9)
          .map(([key]) => ({ day: i, nutrient: key })))
    };
  }
}
console.log(JSON.stringify({ experimental: true, variances,
  unsupportedNutrients: Object.keys(variances).filter(key => !(key in nutrients)),
  timing: 'Daily macros; weekly fiber and micronutrients. Rank Gaussian results by log-score.',
  micronutrients: micros, results }, null, 2));
