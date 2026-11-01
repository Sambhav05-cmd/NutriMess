import { performance } from 'node:perf_hooks';
import { generatePlan, scoreStrategy } from '../server/planner.js';
import { foods, messMenuPreset } from '../server/catalog.js';
import { newStudent } from '../server/accounts.js';
import { targets } from '../server/nutrition.js';

const runs = Number(process.env.BENCHMARK_RUNS || 3);
if (!Number.isInteger(runs) || runs < 1 || runs > 20) throw new Error('BENCHMARK_RUNS must be an integer from 1 to 20.');
const results = {};
for (const name of ['sample', 'nitk']) {
  const state = newStudent();
  if (name === 'nitk') state.menu = structuredClone(messMenuPreset.menu);
  const target = targets(state.profile), start = '2026-11-02';
  generatePlan(state, foods, target, start); // Warm up compilation and caches.
  const timesMs = [];
  let plan;
  for (let i = 0; i < runs; i++) {
    const began = performance.now();
    plan = generatePlan(state, foods, target, start);
    timesMs.push(performance.now() - began);
  }
  const sorted = [...timesMs].sort((a,b) => a-b), middle = Math.floor(runs/2);
  results[name] = {
    medianMs: runs % 2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2,
    timesMs,
    objectiveScore: scoreStrategy(plan, foods, target, state.profile, state).objectiveScore,
    entries: plan.days.reduce((n,day) => n+day.entries.length,0)
  };
}
console.log(JSON.stringify({node:process.version,runs,results},null,2));
