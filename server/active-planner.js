// One selector shared by HTTP requests, strategy scores and worker threads.
// The original production algorithm and its rules remain isolated in legacy/.
const requested = process.env.NUTRIMESS_PLANNER
  || (process.env.NUTRIMESS_GAUSSIAN === '0' ? 'main' : 'gaussian');
if (!['gaussian', 'main', 'legacy'].includes(requested)) {
  throw new Error('NUTRIMESS_PLANNER must be gaussian, main, or legacy.');
}
export const gaussianExperiment = requested === 'gaussian';
const planner = await import(requested === 'gaussian'
  ? '../experiments/gaussian/planner.js'
  : requested === 'legacy' ? './legacy/planner.js' : './planner.js');
export const { generatePlan, refreshPlanNutrition, scoreStrategy } = planner;
// The original planner predates per-food preflight validation.
export const planningConflicts = planner.planningConflicts || (() => []);
export const scoringMode = Object.freeze({
  id: requested,
  label: {gaussian: 'Gaussian planner', main: 'Main planner', legacy: 'Original planner'}[requested],
  calorieVariance: gaussianExperiment
    ? (await import('../experiments/gaussian/parameters.js')).variances.calories : null,
  hardCalorieCap: false
});
