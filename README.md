# NutriMess 🌱

A working JavaScript / Express nutrition planner for vegetarian hostel students. The frontend is responsive, buildless HTML, CSS and JavaScript; MongoDB Atlas stores hosted accounts and student data; SQLite remains available for local development.

For Render Free + MongoDB Atlas Free hosting, see [DEPLOYMENT.md](DEPLOYMENT.md). The repository includes the Render blueprint and an optional Netlify frontend build.

## Run

Requires **Node.js 24 or newer** (uses built-in `node:sqlite`) and **Python 3** to extract the supplied INDB Excel files on the first run or after source changes. The extractor uses only Python's standard library; no Python packages or Excel installation are needed.

```sh
npm install
npm start
```

Open **http://127.0.0.1:3000**. Optional environment variables: `PORT`, `HOST`, `DB_PATH`. The default listens on **0.0.0.0** (all IPv4 interfaces). Set `HOST=127.0.0.1` to restrict it to this computer. Without `MONGODB_URI`, local development uses SQLite. Hosted production requires `MONGODB_URI` and optionally `MONGODB_DB` (default `nutrimess`).

For phone troubleshooting, open `http://<computer-LAN-IP>:3000/?debug=1`. The on-page startup diagnostics and browser console show script loading, account/catalog stages, request statuses and timings. Failures automatically reveal the panel, including when the app script cannot load; stalled startup is flagged after eight seconds and GET requests time out after twenty seconds. Debug API requests also print matching request IDs and timings in the server terminal. Set `DEBUG_REQUESTS=1` to log all server requests. Logs omit request bodies, passwords, cookies and tokens. Plain HTTP responses retain the security policy but do not force assets to HTTPS; HTTPS connections retain Helmet's HTTPS policies.

```sh
npm run dev          # restart when server files change
npm run import:data  # regenerate combined catalog and IFCT/INDB import reports
npm test            # nutrition, optimizer and HTTP integration tests
```

## Use

1. **Log in or create an account first.** Signup asks for name, gender, and college/hostel menu. Passwords must be nonempty and at most 128 characters; there is no minimum-length rule. Gender is the single profile field used for the existing nutrition equations; older gender/sex records are normalized on login or access. Initial age is 21, activity is moderate, and editable Indian adult reference measurements are male 163 cm / 65 kg or female 151 cm / 55 kg. These are starting reference values, not measured vitals or population means. Update them in **Your profile**.
2. In **Mess menu**, choose an institutional preset, an illustrative sample, or your own menu, then save availability and attendance. Institutional presets are partial vegetarian catalog mappings from tentative NIT Tiruchirappalli menus and the IIT Palakkad 2026 catering tender sample. Unsupported dishes are omitted and recipe proxies are explained. Check your actual mess before using them. Personal college templates remain private to your account.
3. In **Weekly planner**, build a suggestion. Choose **Edit & save suggested plan** to turn it into an editable strategy. **Create my own plan** starts an empty Monday–Sunday strategy. Add foods, edit portions or remove selections in each meal, enter a name and notes, then **Save strategy**. Draft edits do not affect actual logs.
4. **Saved strategies** lets you edit, delete, download a PDF, **Log a meal**, or **Use for missed meals**. Logging copies that date's weekday meal into actual intake and protects existing logs from replacement. PDFs are generated directly into the HTTP response and never persisted in the app's database or filesystem. Saving a strategy does not automatically activate it.
5. At signup, an initial optimizer strategy becomes active from today. Active strategies repeat by weekday. Completed unlogged meals are assumed to follow that saved version, including days when the user is absent. Estimates appear after breakfast 10:00, lunch 15:00, snacks 18:00 and dinner 22:00 in Asia/Kolkata. Nothing is inferred before activation or for future meals. Changing a strategy requires reactivation to update assumptions; historical activation snapshots are preserved. A new activation replaces the current day's version and affects subsequent days.
6. In **Log meals**, actual logs override the assumption for the entire meal. Open **Edit meal / Log from menu**, tick foods and edit portions, add off-menu foods or dairy, then save. Save an empty meal to explicitly record a skipped meal, suppressing assumptions. Meal replacement checks for stale edits from another tab. Overview and nutrition history include clearly labeled logged + assumed intake; estimates are stored separately from actual logs and do not prove consumption.
7. Export your profile, menu, actual and assumed intake, saved strategies and activation history as JSON from the journal.

Existing prototype records are retained. Creating an account from a browser with its old UUID cookie claims that browser's unclaimed local record, preserving measurements, menus and actual logs. A missing old cookie cannot recover an anonymous record. No password reset or email verification is implemented.

## Accounts and persistence

MongoDB Atlas stores hosted accounts, hashed session tokens, compact student profile/log/strategy documents, shared college menus, and reference documents. Local development can use the SQLite adapter. Passwords use Node's scrypt with a unique random salt and constant-time verification. Login rotates the random session token; sessions expire after 30 days and logout revokes them. Cookies are HTTP-only, SameSite Strict and Secure on HTTPS. Auth endpoints are rate-limited per client IP. Cross-origin writes are rejected.

Set `MONGODB_URI` for Atlas and `MONGODB_DB` for its database name. Without a URI, non-production runs use `.data/nutrimess.sqlite`; set `DB_PATH` to use another local location. Production refuses an absent Atlas URI. The `students` document contains actual logs, saved strategy revisions, explicit completed/skipped meal markers and activation snapshots. Missed-meal estimates are derived on read, so no background task or PDF storage is required. Separate `college_menus` and `reference_documents` collections/tables are seeded idempotently at startup from versioned source snapshots. User-created templates never overwrite the shared institutional presets.

Student documents use compact storage version 1. The `food_ids` dictionary maps stable integer IDs to catalog string keys; mappings survive catalog reordering and retain retired foods. Stored food references use those integers, and meal values use `breakfast=0`, `lunch=1`, `dinner=2`, `snacks=3`. Explicit meal completion is stored as `completedMealMasks`, an object mapping dates to four-bit masks (bits 0–3 follow the same meal order). Fractional portions remain numeric. The storage adapter restores readable string IDs and completion records for the API and planner; shared catalog/menu source documents retain their readable IDs.

The local SQLite adapter migrates legacy student documents transactionally. Atlas retains compact encoding and a persistent numeric food dictionary; conditional saves use revisions to reject stale writes. Back up student data and its food dictionary together. The read-only SQLite import command transfers missing accounts, student documents and unexpired sessions without replacing existing Atlas records. See the deployment guide for preview and import commands.

## Datasets and units

The startup importer reads `ifct2017/compositions/index.csv`, using its explicit vegetarian tags. The supplied `vegetarian_foods.csv` is derived from the same source; the canonical composition file gives explicit source field codes for unit conversion. Source files are preserved.

**INDB supplements missing foods.** After loading IFCT ingredients, verified USDA dairy, and existing NutriMess recipes, the importer reads the supplied `Anuvaad_INDB_2024.11.xlsx`. Supporting ingredient lists and UK/US reference workbooks come from `Indian-Nutrient-Databank-INDB-/`. Existing IDs and nutrient values are preserved. Reviewed equivalent recipes (such as idli, plain dosa, chapati, vegetable poha and palak paneer) and matching names reuse the existing entry. Distinct preparations remain separate. Supplemental ingredients reuse main IFCT/USDA records where the equivalence is known, including sunflower oil, ghee, curd and cheddar.

The current sources add **308 recipes and 165 ingredient references**. Another 14 recipe records match an existing entry; 692 are withheld because their ingredients are non-vegetarian, ambiguous, unresolved or lack required macro data, or their serving/oil estimates need review. These counts are derived on import and can change with source revisions. Import decisions and reasons are available in **How it works** and `.data/indb-import-report.json`. INDB foods work in food search, custom menus, preferences, the planner, saved strategies and logs.

INDB native serving units are retained when both a label and a valid energy value exist. Other recipes use **100 g of the source recipe**, rather than inventing a bowl size. INDB ingredient quantities are original **batch** quantities, not per-serving gram weights. Source recipe nutrient estimates are used directly rather than recalculating them from those batch quantities. Excessive serving energy/fat and oil-heavy estimates are excluded. Nutrient A and E fields do not establish the RAE/alpha-tocopherol definitions used here and remain unknown; B12 is absent. Ambiguous micronutrient zeros and subtotals involving unknown ingredient contributions remain `null`. UK ingredient `N`, `NA` and blanks remain unknown. Trace macros (`Tr`) are approximated as zero with explicit metadata and a source note; trace micronutrients remain unknown. Screening does not certify actual product formulations, vegetarian rennet or cross-contact.

The unmodified workbooks remain the source of truth. `scripts/extract-indb.py` builds a reproducible JSON snapshot using ZIP/XML extraction. Source and extractor SHA-256 checksums trigger regeneration on changes; unchanged startup reads the cached snapshot. Keep the supplied root workbook and the supporting repository workbooks together when deploying. `.data/indb-source.json` and `.data/catalog.json` are generated and ignored by Git. The cloned INDB repository has no explicit license file; public availability alone does not establish redistribution terms.

- Energy: kJ / 4.184 → kcal. Protein, carbohydrate, fat and fiber: grams.
- Micronutrient mass fields: source grams → mg or µg, as appropriate.
- Vitamin A: retinol + beta-carotene / 12 + alpha-carotene / 24 + beta-cryptoxanthin / 24, expressed as µg RAE.
- Vitamin D: D2 + D3, in µg; 25-OH-D3 is not included. Vitamin E uses alpha-tocopherol; folate uses food folate.
- B12 is not present in this IFCT schema. It remains `null` in those foods. The separately downloaded USDA yogurt and cheddar references include B12, as do dairy recipes made entirely from ingredients with known B12 values. Known subtotals use zero contribution from missing values, with a separate incomplete-data flag.
- Prepared dishes are ingredient-weight estimates. Ingredient details are shown when selecting a food; recipes live in `server/catalog.js`. Cooking retention, actual yields, salt and differences in mess preparation are not fully modeled. IFCT ingredients use a 100 g edible-ingredient serving, usually raw. Do not treat 100 g raw rice as 100 g cooked rice.

The supplied USDA folder lacks `food.csv` and `food_nutrient.csv`. Its `sub_sample_result.csv` contains lab results keyed to nutrient-row IDs, not enough to join food identities and per-100 g nutrients. The app reports this incomplete export and imports **no invented USDA values**. A complete USDA import with verified food classification and nutrient mapping is future work.

**Dairy is included by default.** Milk, buffalo milk, paneer, khoa and ghee use IFCT ingredients. Plain curd/yogurt and cheddar use two official USDA SR Legacy records fetched from the FoodData Central API on 2026-10-30 and saved in [`data/usda-dairy-source.json`](data/usda-dairy-source.json). Chaas, unsweetened lassi and carrot raita are ingredient-based estimates. Yogurt is a reference for Indian curd, not a measurement of every dahi recipe. Generic cheddar composition does not verify vegetarian rennet; select cheese labeled suitable for vegetarians. The dairy filter and quick-add button work in food pickers; **Avoid dairy** excludes dairy and dairy dishes from plans. Existing personal menus are preserved; add the new options through menu editing. Fresh sample menus include curd and chaas.

The supplied IFCT package is credited to Subhajit Sahu and carries **AGPL-3.0-or-later** (`ifct2017/LICENSE`); its original composition measurements are from NIN, Hyderabad. Preserve those notices and review redistribution obligations when deploying. Application code is also provided under AGPL-3.0-or-later; see `LICENSE`.

## Planner

The selectable **NITK · uploaded mess menu** uses `nitk_mess_96_foods_per_indian_serving.csv` as the fallback source of nutrition values for 96 stable `nitk-*` food IDs. `nitk_mess_weekly_nutrients_all_estimated.csv` supplies the 254 Monday–Sunday meal entries only; its repeated nutrient columns are not imported. Matching IFCT/USDA records take precedence at the nutrient level, including known zeros; CSV and INDB Excel estimates supply missing compatible foods or nutrient values. Reviewed direct NITK matches are curd (USDA), banana (IFCT robusta variety proxy), and plain paneer (IFCT), scaled to each uploaded serving's edible weight. Raw grain data never directly overrides a cooked dish. The supplied USDA export lacks the identity/nutrient join files, so its missing values cannot be fabricated; saved official USDA reference records remain usable. Each NITK nutrient has its selected source recorded. Earlier uploads are retained as reference files.

All 96 dishes have macro estimates per listed Indian household serving, such as one idli (60 g), one rice bowl (140 g), or one small katori of curd (150 g). One portion uses that serving, even when the dish name lists multiple pieces. Oats and cornflakes use the supplied dry serving weights. Portion evidence, explanation, available weight ranges, volume and source links are retained. These are reference portions rather than measured NITK mess portions. Vitamin A uses the RAE column; vitamin K1 is a partial vitamin K contribution. Modeled D/B12 zeros reflect recipe and fortification assumptions rather than analytically measured absence. The current upload includes all tracked nutrients plus sodium, phosphorus, B3, B5 and free sugar. Blank values remain unknown.

Saved choices and portion counts keep their food IDs and refresh nutrition against the current catalog. Existing NITK portion counts now refer to the new listed servings. Review older logs and strategies whose counts were entered as 100 g portions, and regenerate a strategy to optimize choices using the updated servings.

The app builds one shared catalog in `server/catalog.js`, keyed uniquely by food ID, and atomically writes the exact same data to `.data/catalog.json`. The API, menu, optimizer, strategies and logs resolve nutrient values from that catalog. The snapshot contains a content version and source-file checksums. Saved plan summaries refresh against that version on read, preserving chosen foods and portions; regenerate to optimize choices against updated values. Open **Mess menu → Menu items nutrition stats** for a deduplicated list of all foods in the selected weekly menu. The menu grid shows food names; the separate stats view lists serving-based macros and expandable nutrient details. Food details preserve reference/proxy confidence, recipe proportions and vitamin-source notes, plus sodium, phosphorus, B3, B5, free sugar and unconverted INDB vitamin A. The current food/serving CSV and weekly schedule CSV can be downloaded from the app. Existing IFCT/USDA foods keep their separate serving definitions and values.

This is an approximate multidimensional bounded knapsack approach, not an exact solver:

1. Generate a complete reusable Monday–Sunday suggestion using saved menu availability, attendance and preferences. Earlier weekdays are included. The generation API sets aside actual logs, assumed intake and explicit skip markers so journal history cannot remove days or meals from the reusable strategy. The journal remains the record of actual and assumed intake.
2. Gather available menu dishes and extras dated for that day and meal; filter out exclusions, recipes containing excluded ingredients, and dairy when requested.
3. Explore 0–2 servings of every available dish in quarter-serving steps. A diverse beam of up to 512 candidates bounds runtime; there is no dish-count limit per menu or meal. Partial scores follow meal energy shares (25% breakfast, 35% lunch, 30% dinner, 10% snacks, normalized over available unlogged meals), reserving room for later meals. Daily calorie ceiling and implemented micronutrient upper limits are hard constraints for additions.
4. Penalize normalized daily macro error exponentially: `expm1(4 × abs(intake / target − 1))`, weighted protein 3, calories 2, carbs/fat 1. Weekly micronutrients use `expm1(4 × max(0, 1 − intake / weekly_target))`; excess earns no reward. Favorites retain a small bonus. Keep nutrient specialists during beam pruning so rare D/B12 sources survive. Coordinate refinement uses four deterministic starting combinations and up to sixteen passes each, stopping at convergence, to select daily candidates against seven-day micronutrient coverage. Selecting more dishes carries no score penalty.
5. Report gaps below 90%, incomplete nutrient data and daily energy/protein shortfalls. An optimistic bound sums two portions of every allowed available dish, ignoring calorie and upper limits; if even this bound misses a known nutrient target, the UI identifies the menu constraint. The bound is not an achievable prescription or a measured intake. Nutrient score contribution saturates at weekly target, so excess earns no extra coverage reward. Existing logs remain in the journal and are not rewritten by strategy generation. The underlying solver can also account for logs when called directly, but the weekly generation API builds an independent reusable suggestion.

There is no guarantee of a global optimum or nutritional completeness. Meal choices and calorie limits can make targets infeasible. Fiber is included in weekly coverage. Implemented daily general total-food ULs cover vitamin C, D, calcium, iron and zinc. Supplement-specific ULs are not applied to natural food folate, magnesium, etc. Other constraints such as sodium, cost, iron bioavailability, nutrient interactions, and meal-volume limits are not modeled.

## Targets and decay

Scope: general adult planning for **ages 19–30**, excluding pregnancy, lactation and medical conditions. Nutrient targets are sex-specific US DRIs, not individualized Indian clinical recommendations. Energy uses Mifflin–St Jeor × approximate activity multipliers. Protein is a planning choice of 1.2 g/kg, or 1.6 g/kg for very active users; fat is 28% of energy and carbs fill the remainder. These choices are explicit in `server/nutrition.js`.

- [NIH nutrient recommendations](https://ods.od.nih.gov/healthinformation/nutrientrecommendations.aspx)
- [National Academies DRI reference tables](https://www.ncbi.nlm.nih.gov/books/NBK208874/)
- [IFCT dataset documentation](https://ifct2017.github.io)

Weekly coverage compares intake with seven daily targets. It is a planning heuristic, not permission to replace daily needs with a weekly bolus. Food estimates do not diagnose deficiency, determine absorption, or prescribe supplements.

Turnover evidence, reviewed date, ranges, compartments, model choices and source URLs are saved in [`data/nutrient-turnover.json`](data/nutrient-turnover.json) and displayed in **How it works**. The old shared 0.80 setting is retired; existing logs are preserved.

For nutrients with a supported reference coefficient, the recorded intake signal on date `D` is:

```text
signal (target-days) = Σ(min(recorded intake[n, day] / target[n], 1) × retention^ageDays)
retention = 1 - fractional loss per day
         or 2^(-1 / halfLifeDays)
```

A target-day represents one daily intake target, capped at one recorded contribution per day, then weighted by the reference coefficient. Actual logs and derived historical assumptions are used; B12 is not artificially forgotten after 28 days. Completed unlogged meals contribute estimates from the active strategy, separately labeled as assumed intake. Dates outside strategy coverage remain unknown; they do not establish fasting. Initial body stores remain unknown. This applies population turnover references to intake as an explicit visualization assumption; it **does not estimate absorbed dose, retained body amount, blood levels, stores, or adequacy**.

| Nutrient | Reference used in intake-history visualization | Qualification |
| --- | --- | --- |
| B12 | 0.1% daily fractional loss; derived half-time ~692.8 days | National Academies review reports 0.1–0.2%; reference assumes healthy recycling. Not time to deficiency. |
| Vitamin A | 0.5% daily loss; derived half-time ~138.3 days | Adult vitamin-A-free diet studies; applying to intake is a model assumption. |
| Vitamin C | 24-day half-life | Chosen midpoint of a reported 8–40 day range; varies with intake and body pool. |
| Thiamin / B1 | 13.5-day half-life | Chosen midpoint of the DRI review's estimated 9–18 day range. |
| B6 | ~25-day half-life | Historical tracer model; its representation of slow muscle stores is questioned by the source. |

Other nutrients use daily intake reporting without a fabricated half-life. Vitamin D's reported 15-day circulating **25(OH)D** half-life is saved as evidence but is not applied to dietary D2/D3. Folate has fast/slow pools, and minerals have storage, recycling and homeostatic regulation that cannot be summarized by one reliable food-decay constant here. Calories and macros use daily budgets: energy can be used or stored, not biologically reset at midnight. Dates use Asia/Kolkata on the server.

References for the coefficients: [B12](https://www.ncbi.nlm.nih.gov/books/NBK114302/), [vitamin A](https://www.ncbi.nlm.nih.gov/books/NBK222318/), [vitamin C](https://www.ncbi.nlm.nih.gov/books/NBK225480/), [thiamin](https://www.ncbi.nlm.nih.gov/books/NBK114331/), [B6](https://www.ncbi.nlm.nih.gov/books/NBK114313/). The saved evidence file includes references for every daily-only nutrient too.

## Structure and deployment scope

```text
server/index.js       Express routes, validation and application startup
server/storage.js     Atlas selection and local SQLite fallback
server/mongo-store.js MongoDB transactions, compact documents and session storage
server/nutrition.js   units, targets, totals, date helpers
server/turnover.js    sourced nutrient-specific intake-history weighting
server/catalog.js     IFCT catalog and ingredient-based recipe estimates
server/planner.js     constrained beam search and weekly refinement
scripts/import-data.js
public/              responsive frontend, no build step or CDN dependency
test/                Node test runner tests
data/                saved turnover evidence and official USDA dairy snapshot
.data/               generated catalog and SQLite (ignored by Git)
```

This is a **localhost prototype with password accounts**. Before public deployment add email verification and account recovery, HTTPS termination, shared rate limiting for multiple instances, worker-based optimization for larger workloads, backups, data retention and deletion controls, privacy review and qualified nutrition review. Account creation is transactional, and student saves reject stale revisions; numeric and catalog inputs are validated, same-origin writes are enforced, and Helmet sets security headers.

Hosted menus, profiles and logs survive Render restarts in Atlas. Local SQLite data remains in `.data/nutrimess.sqlite`. The normalized catalog regenerates from the supplied CSV on startup. Clearing the browser cookie signs you out; log in with the same credentials to recover your account. JSON import and password recovery are not implemented.

## Saved source snapshots

- `data/college-menus.json`: three menu presets across two institutions, each with source URL, source page, reviewed date, publication status and mapping limitations. Sources: [NITT tentative hostel menus](https://nitt.edu/home/MENU-NITT-MESSES.pdf) and [IIT Palakkad 2026 catering tender, Annexure A](https://iitpkd.ac.in/sites/default/files/2026-04/TENDER%20DOC%20FOR%20MESS%20SERVICE.pdf).
- `data/reference-library.json`: editable anthropometry defaults from [Vikaspedia](https://aspirational.vikaspedia.in/viewcontent/health/nutrition/dietary-guidelines-1/recommended-dietary-allowance?lgn=en), and age/sex reference rows from official NIH [vitamin B12](https://ods.od.nih.gov/factsheets/VitaminB12-HealthProfessional/) and [magnesium](https://ods.od.nih.gov/factsheets/Magnesium-HealthProfessional/) tables. These source-context rows do not expand the app beyond adult 19–30 planning.
- Existing IFCT food compositions, USDA dairy snapshots and the nutrient-specific turnover evidence remain in use. Startup also copies the dairy and turnover reference documents into SQLite. Sources and the additional reference tables appear in **How it works**. Source websites blocked some bulk downloads, so no unavailable material or nutritional values were invented.

Run `npm test` for account isolation/logout, strategy revisions and logging, PDF response validation, multiweek assumed intake, explicit skips, and complete frontend flows in addition to existing nutrition/optimizer checks.
