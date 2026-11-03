# Gaussian planner

The production app now defaults to this implementation for generated plans, initial-plan workers, strategy scores and food-impact colors. `server/active-planner.js` selects `NUTRIMESS_PLANNER=gaussian` (default), `main` (updated exponential planner), or `legacy` (original production planner preserved in `server/legacy/`). `npm run dev:main` and `npm run dev:legacy` are development shortcuts.

Restart after changing modes, then regenerate suggestions. Saved food choices are not automatically reoptimized. Both production and development use normal storage configuration. The standalone comparison command does not open the user database or save plans.

Run from the repository root:

```sh
node --test experiments/gaussian/gaussian.test.js
node experiments/gaussian/compare.js
```

The comparison generates fresh plans for the sample and NITK menus using both
planners. It scores **both plans under both methods**, reporting runtime, weekly
coverage ratios, unknown nutrients, rule exceptions and daily upper-limit violations.
Scores from different methods are not on comparable scales. Higher log-score is
better when comparing plans under the Gaussian method.

`planner.js` is an isolated snapshot of the current working-tree planner. Its beam
search, portions, exclusions, rule handling and hard nutrient upper-limit checks
are retained. Its search and displayed score use the same Gaussian objective:

```
gap = max(0, intake / target - 1)  # calories only
gap = max(0, 1 - intake / target)  # every other tracked nutrient
logScore = -sum(gap² / (2 * variance))
value = 100 * exp(logScore)
```

Calories, protein, carbs and fat contribute once per day. Fiber and micronutrients
contribute once per week against seven daily targets, matching the app's current
time horizons. A profile calorie cap replaces the energy target. Calories below
the cap have zero penalty. Protein, carbs and fat use lower-bound penalties in this
prototype; the app currently supplies point targets rather than intake ranges.
There is no new energy minimum or macro range constraint.

`parameters.js` contains the proposed dimensionless variances. Calories use variance 0.0001 (1% normalized standard deviation), making the
excess penalty 900 times stronger than the initial 0.09, and 25 times stronger
than the previous 0.0025. At 5% excess the calorie component is about 0.00000373. At or below the target it remains
1. This is still a soft penalty, so exceeding the target remains possible. Macros
start at 0.09; the vitamin/mineral values follow the supplied prototype table.
These are heuristic calibration choices, not clinical adequacy probabilities.
No additional macro weights, weekly multiplier or favorites bonus enter the final
product. A micronutrient heuristic still helps prune partial beam candidates; the
final selection objective is the log-score above. Approximate search does not
guarantee a global optimum or improvement under either score.

The parameter table includes vitamins/minerals not yet tracked by the app. The
comparison lists those as `unsupportedNutrients`; they are **not scored** without
catalog data and targets. Unknown values in tracked nutrients remain flagged in
`incomplete`. As in the current planner, optimization uses known subtotals, so an
unknown contribution is numerically zero, not evidence of zero actual intake.
Existing upper-limit checks cover only the nutrients already supported by the app.

Keep the raw log-score for ranking: the displayed product can become tiny or
underflow to zero. The experiment returns its unrounded value. The snapshot will
not automatically pick up future main-planner changes; review it before reuse.

## Trial results

The current `results.json` records the corrected partial-meal calorie scoring and
per-food refinement. After the weekly beam selection, every allowed quantity of
every food is reconsidered against the full daily-macro/weekly-micronutrient
objective. Changes preserve daily defaults, food/group quantity constraints and
existing nutrient upper limits. Up to 64 sweeps stop when no improving single-food
change remains. This remains an approximate local search, not a global guarantee.

With the default 2,432 kcal target, sample and NITK generated days were all at or
below the calorie target. Sample scored 100; NITK scored 0.00140989 (log-score
-11.1694). Small scores are displayed in scientific notation instead of rounded
to zero. Gaussian food effects use differences in log-score and are labeled as
such; the main mode retains its original points conversion.

An additional NITK run with a 2,000 kcal target produced 1,997.85–2,002.30 kcal/day.
Monday breakfast selected two idlis rather than five. Small excess remains allowed
by the soft scoring function; no hard calorie limit was added. These runs use the
default profile/menu, not the user's saved state.

Fifteen focused checks passed, including NITK calorie regression, independent
brute-force comparison, underflow-safe food effects, browser score rendering and
main-mode local regressions. The earlier full repository-suite run reported 22
failures and was not rerun for this scoped change.

## Exhaustive search

The normal experimental beam now retains 2,048 candidates instead of 512.
For an exact offline run with no node/time cutoff:

```sh
node experiments/gaussian/run-exhaustive.js --menu=nitk --out=/tmp/nutrimess-exact.json
```

This is separate from the HTTP planner, to avoid blocking the server. It searches
all days jointly over all current discrete portion options; it does not truncate
the daily candidates or use coordinate refinement as the final solver. The beam
plan only supplies an initial complete incumbent. Exact branch-and-bound skips
infeasible branches and branches with an optimistic Gaussian score below the
incumbent. No hard calorie limit is introduced. `complete: true` and `optimal:
true` mean the solver exhausted/proved the optimum within the configured menu,
portion steps, maximum five portions and existing search constraints. These fields
remain false if an optional node budget stops the search.

To inspect the raw space or run a bounded diagnostic:

```sh
node experiments/gaussian/run-exhaustive.js --menu=nitk --estimate
node experiments/gaussian/run-exhaustive.js --menu=nitk --max-nodes=100000 --out=/tmp/nutrimess-exact-trial.json
```

`--state=/path/to/student-state.json` uses a supplied state rather than the default
sample profile. Logs are cleared for reusable weekly planning, as in the app.
Results are written to the selected file; the account database is not modified.

The default NITK trial has 251 decisions. Its raw product (~5.45e206) already
reflects per-food allowed quantities but precedes joint group/upper-limit checks
and objective pruning. It is not a feasible-plan count. The first 100,000 visited
nodes yielded 89,467 bound prunes, 10,936 infeasible option skips, and three evaluated
complete leaves. It did not finish or prove optimality. The exact solver also
completed an 81-combination test and matched independent brute-force enumeration.
