import { foodImpacts } from './food-impact.js';
import express from 'express';
import helmet from 'helmet';
import { randomUUID } from 'node:crypto';
import { installAccounts } from './accounts.js';
import { installStrategies, effectiveIntake } from './strategies.js';
import { messMenuSource, messFoodSource } from './mess-menu.js';
import { seedColleges, listColleges, referenceLibrary } from './colleges.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalog, foods, slots, dataReport, catalogVersion } from './catalog.js';
import { nutrients, targets, totals, dateKey, monday, normalizeGender, portionStep } from './nutrition.js';
import { turnoverEvidence, intakeHistory } from './turnover.js';
import { generatePlan, refreshPlanNutrition, scoreStrategy, planningConflicts, scoringMode } from './active-planner.js';
import { planningRulesFor, defaultPlanningRules, planningGroupName } from './planning-rules.js';
import { openStorage } from './storage.js';
import { ensureInitialPlan } from './initial-plan.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const storage = await openStorage({ catalog });
export const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
const publicOrigin = process.env.PUBLIC_ORIGIN ? new URL(process.env.PUBLIC_ORIGIN).origin : null;
const httpHeaders=helmet({contentSecurityPolicy:{directives:{upgradeInsecureRequests:null}},strictTransportSecurity:false});
const httpsHeaders=helmet();
app.use((req,res,next)=>(req.secure?httpsHeaders:httpHeaders)(req,res,next));
app.use((req,res,next)=>{
  if(process.env.DEBUG_REQUESTS!=='1'&&req.headers['x-nutrimess-debug']!=='1'&&req.query.debug!=='1')return next();
  const id=randomUUID(),start=performance.now();
  res.set('X-Request-ID',id);
  console.info(`[NutriMess ${id}] ${req.method} ${req.path} started`);
  res.once('finish',()=>console.info(`[NutriMess ${id}] ${req.method} ${req.path} ${res.statusCode} ${Math.round(performance.now()-start)}ms`));
  res.once('close',()=>{if(!res.writableFinished)console.warn(`[NutriMess ${id}] ${req.method} ${req.path} connection closed before completion`);});
  next();
});
app.use(express.json({ limit: '100kb' }));
await seedColleges(storage);
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  if (!['GET','HEAD','OPTIONS'].includes(req.method) && req.headers.origin && req.headers.origin !== `${req.protocol}://${req.get('host')}` && req.headers.origin !== publicOrigin) return res.status(403).json({ error: 'Cross-origin writes are not allowed.' });
  next();
});
installAccounts(app, storage, { response });
function fail(message) { const err = new Error(message); err.status = 400; throw err; }
function num(value, min, max, label) { if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`${label} must be between ${min} and ${max}.`); return value; }
function text(value, max, label) { if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`${label} must be 1–${max} characters.`); return value.trim(); }
function date(value) { if (typeof value !== 'string' || !/^20\d{2}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T12:00:00Z`)) || new Date(`${value}T12:00:00Z`).toISOString().slice(0,10) !== value) fail('Use a valid date in YYYY-MM-DD format.'); return value; }
function foodId(id) { if (typeof id !== 'string' || !foods.has(id)) fail('Choose a food from the catalog.'); return id; }
function portionAmount(id, value) {
  const amount = num(value, .1, Number.MAX_VALUE, 'Portions');
  if (portionStep(foods.get(id)) === 1 && !Number.isInteger(amount)) fail('Use whole portions for foods not served in bowls.');
  if (!Number.isInteger(amount / portionStep(foods.get(id)))) fail('Use multiples of half a portion for bowl or katori servings.');
  return amount;
}
function meal(value) { if (!slots.includes(value)) fail('Choose breakfast, lunch, dinner or snacks.'); return value; }
function ids(value) { if (!Array.isArray(value) || value.length > 500) fail('Invalid food preference list.'); return [...new Set(value.map(foodId))]; }
function validateMenu(menu) {
  if (!Array.isArray(menu) || menu.length !== 7) fail('A menu needs seven days, Monday to Sunday.');
  return menu.map(day => Object.fromEntries(slots.map(slot => {
    if (!Array.isArray(day?.[slot])) fail('Each meal needs a list of available dishes.');
    return [slot, [...new Set(day[slot].map(foodId))]];
  })));
}
async function response(req) {
  const s = req.student, target = targets(s.profile), today = dateKey();
  if (s.initialPlan?.status === 'pending') ensureInitialPlan(storage, req.studentId);
  if(s.plan&&s.plan.catalogVersion!==catalogVersion){
    s.plan=refreshPlanNutrition(s.plan,foods,target,s);
    s.plan.catalogVersion=catalogVersion;
    await req.save();
  }
  const estimatedLogs = effectiveIntake(s), combined = [...s.logs, ...estimatedLogs];
  const score = strategy => scoreStrategy(strategy,foods,target,s.profile,s);
  return { ...s, plan: s.plan ? {...s.plan, strategyScore: score(s.plan), foodImpacts: foodImpacts(s.plan,foods,target,s.profile,s,s.plan.days.flatMap((day,i)=>day.entries.map(e=>({day:i,meal:e.meal,foodId:e.foodId})))).impacts} : null,
    scoringMode, planningRules: planningRulesFor(s.profile), strategyScores: Object.fromEntries(s.strategies.map(strategy=>[strategy.id,score(strategy)])),
    activeStrategyScore: s.activations.length ? score(s.activations.at(-1)) : null,
    estimatedLogs, today, weekStart: monday(today), targets: target, nutrients,
    todayUnknown: Object.keys(nutrients).filter(k => combined.some(l => l.date === today && foods.get(l.foodId)?.nutrients[k] === null)),
    todayTotals: totals(combined.filter(l => l.date === today), foods),
    turnoverEvidence, intakeHistory: intakeHistory(combined, foods, target, today, s.nutritionBaseline) };
}
async function changed(req, res) { req.student.plan = null; await req.save(); res.json(await response(req)); }
app.get('/api/catalog', async (req, res) => res.json({ foods: catalog, report: {...dataReport, referenceLibrary: await referenceLibrary(storage)}, colleges: [...(await listColleges(storage)), ...req.student.colleges] }));
app.get('/api/state', async (req, res) => res.json(await response(req)));
app.get('/api/mess-menu/source', async (req, res) => res.download(fileURLToPath(messMenuSource)));
app.get('/api/mess-menu/foods-source', async (req, res) => res.download(fileURLToPath(messFoodSource)));
app.put('/api/profile', async (req, res) => {
  const p = req.body;
  const gender=normalizeGender(p.gender??p.sex);
  if (!gender) fail('Choose your gender.');
  if (!['sedentary','light','moderate','active'].includes(p.activity)) fail('Choose an activity level.');
  if (typeof p.dairyFree !== 'boolean') fail('Dairy preference must be a boolean.');
  req.student.profile = { name: text(p.name, 60, 'Name'), age: num(p.age, 19, 30, 'Age'), gender,
    height: num(p.height, 120, 230, 'Height (cm)'), weight: num(p.weight, 35, 250, 'Weight (kg)'), activity: p.activity,
    calorieCap: p.calorieCap === null ? null : num(p.calorieCap, 1000, 5000, 'Calorie ceiling'),
    dairyFree: p.dairyFree, preferred: ids(p.preferred), excluded: ids(p.excluded), planningRules: planningRulesFor(req.student.profile) };
  await changed(req, res);
});
app.put('/api/planning-rules', async (req, res) => {
  const input = req.body, rules = defaultPlanningRules();
  if (typeof input.requireGroups !== 'boolean') fail('Choose whether to require food groups.');
  rules.requireGroups = input.requireGroups;
  for (const key of ['dailyMilk','dailyCurd','consistentPortions']) {
    if (input[key] !== undefined && typeof input[key] !== 'boolean') fail('Daily food and consistent portion settings must be true or false.');
    rules[key] = input[key] ?? rules[key];
  }
  for (const type of Object.keys(rules.minimums)) {
    const value = num(input.minimums?.[type],0,5,`Minimum ${type} pieces`);
    if (!Number.isInteger(value)) fail('Minimum piece counts must be whole numbers.');
    rules.minimums[type] = value;
  }
  for (const group of ['A','B']) rules[`groupMinimum${group}`] = num(input[`groupMinimum${group}`],0,5,`${planningGroupName(group)} minimum`);
  if (!Array.isArray(input.overrides) || input.overrides.length > catalog.length) fail('Invalid food group overrides.');
  const seen = new Set();
  rules.overrides = input.overrides.map(row=>{
    if (!row || typeof row !== 'object') fail('Invalid food group override.');
    const id=foodId(row.foodId);
    if (!['A','B','C'].includes(row.group) || seen.has(id)) fail('Use one valid group per food.');
    seen.add(id);return {foodId:id,group:row.group};
  });
  if (!Array.isArray(input.foodBounds||[]) || (input.foodBounds||[]).length>catalog.length*5) fail('Invalid per-food limits.');
  const boundKeys=new Set();
  rules.foodBounds=(input.foodBounds||[]).map(row=>{
    const id=foodId(row.foodId),slot=row.meal==='all'?'all':meal(row.meal);
    const offered=req.student.menu.some(day=>(slot==='all'?slots.flatMap(s=>day[s]):day[slot]).includes(id));
    if(!offered)fail('Individual food limits must refer to a food in your current menu at the selected meal.');
    const min=num(row.min,0,5,'Minimum portions'),max=num(row.max,0,5,'Maximum portions'),step=portionStep(foods.get(id));
    if(min>max||!Number.isInteger(min/step)||!Number.isInteger(max/step)) fail('Use valid min/max quantities in the food’s portion steps.');
    const key=`${slot}:${id}`;if(boundKeys.has(key))fail('Use one limit per food and meal.');boundKeys.add(key);
    return {foodId:id,meal:slot,min,max};
  });
  req.student.profile.planningRules = rules;
  await changed(req,res);
});
app.put('/api/menu', async (req, res) => {
  const menu = validateMenu(req.body.menu);
  if (!Array.isArray(req.body.attendance) || req.body.attendance.length !== 7) fail('Attendance needs seven days.');
  const attendance = req.body.attendance.map(day => Object.fromEntries(slots.map(slot => {
    if (typeof day?.[slot] !== 'boolean') fail('Meal attendance must be true or false.');
    return [slot, day[slot]];
  })));
  const name = text(req.body.collegeName, 100, 'College or menu name');
  req.student.menu = menu; req.student.attendance = attendance;
  req.student.collegeId = typeof req.body.collegeId === 'string' ? req.body.collegeId.slice(0, 100) : 'custom';
  req.student.collegeName = name;
  await changed(req, res);
});
app.post('/api/colleges', async (req, res) => {
  if (req.student.colleges.length >= 20) fail('You can save up to 20 college menus.');
  req.student.colleges.push({ id: randomUUID(), name: text(req.body.name, 100, 'College name'), example: false, menu: validateMenu(req.body.menu) });
  await req.save(); res.status(201).json(req.student.colleges);
});
app.post('/api/extras', async (req, res) => {
  if (req.student.extras.length >= 500) fail('Remove old extras before adding more.');
  req.student.extras.push({ id: randomUUID(), date: date(req.body.date), meal: meal(req.body.meal), foodId: foodId(req.body.foodId) });
  await changed(req, res);
});
app.delete('/api/extras/:id', async (req, res) => { req.student.extras = req.student.extras.filter(e => e.id !== req.params.id); await changed(req, res); });
app.post('/api/logs', async (req, res) => {
  if (req.student.logs.length >= 15000) fail('The local log limit has been reached.');
  const d = date(req.body.date);
  if (d > dateKey()) fail('Log food after you have eaten it; future meals belong in the planner.');
  const id = foodId(req.body.foodId);
  req.student.logs.push({ id: randomUUID(), date: d, meal: meal(req.body.meal), foodId: id, portions: portionAmount(id, req.body.portions) });
  await changed(req, res);
});
app.delete('/api/logs/:id', async (req, res) => { req.student.logs = req.student.logs.filter(l => l.id !== req.params.id); await changed(req, res); });
app.put('/api/logs/meal', async (req, res) => {
  const d = date(req.body.date), slot = meal(req.body.meal);
  if (d > dateKey()) fail('Future meals cannot be logged yet.');
  if (!Array.isArray(req.body.entries)) fail('A meal needs a list of foods.');
  const existing = req.student.logs.filter(l => l.date === d && l.meal === slot);
  const expected = req.body.expectedLogIds;
  if (!Array.isArray(expected) || expected.some(id => typeof id !== 'string')) fail('Reload the meal before editing it.');
  if (JSON.stringify([...expected].sort()) !== JSON.stringify(existing.map(l => l.id).sort())) return res.status(409).json({ error: 'This meal changed in another tab. Reopen it to load the latest entries.' });
  const portions = new Map();
  for (const entry of req.body.entries) {
    const id = foodId(entry?.foodId), amount = portionAmount(id, entry.portions);
    portions.set(id, num((portions.get(id) || 0) + amount, .1, Number.MAX_VALUE, 'Total portions of a food'));
  }
  if (req.student.logs.length - existing.length + portions.size > 15000) fail('The local log limit has been reached.');
  const replacement = [...portions].map(([id, amount]) => ({ id: randomUUID(), date: d, meal: slot, foodId: id, portions: amount }));
  req.student.completedMeals ||= [];
  req.student.completedMeals = [...req.student.completedMeals.filter(m => m.date !== d || m.meal !== slot), { date: d, meal: slot }];
  req.student.logs = [...req.student.logs.filter(l => l.date !== d || l.meal !== slot), ...replacement];
  await changed(req, res);
});
app.post('/api/plan/log-meal', async (req, res) => {
  const d = date(req.body.date), slot = meal(req.body.meal);
  if (d > dateKey()) fail('Future meals cannot be logged yet.');
  if (req.student.logs.some(l => l.date === d && l.meal === slot)) fail('This meal already has logged food. Add any further foods through the journal.');
  const entries = req.student.plan?.days.find(day => day.date === d)?.entries.filter(e => e.meal === slot);
  if (!entries?.length) fail('Build a current plan before logging a planned meal.');
  if (req.student.logs.length + entries.length > 15000) fail('The local log limit has been reached.');
  req.student.logs.push(...entries.map(e => ({ ...e, id: randomUUID() })));
  await changed(req, res);
});
installStrategies(app, { foods, fail, text, num, date, meal, foodId, response });
app.post('/api/plan/check',async(req,res)=>{
  const start=date(req.body.start||monday());
  if(monday(start)!==start||start<monday())fail('Choose the current week or a future Monday.');
  const planning={...req.student,logs:[],completedMeals:[]};
  res.json({conflicts:planningConflicts(planning,foods,start)});
});
const lastPlan = new Map();
app.post('/api/plan', async (req, res) => {
  const now = Date.now();
  if (now - (lastPlan.get(req.studentId) || 0) < 1000) return res.status(429).json({ error: 'Wait a moment before regenerating your plan.' });
  if (lastPlan.size > 10000) lastPlan.clear();
  lastPlan.set(req.studentId, now);
  const start = date(req.body.start || monday());
  if (monday(start) !== start) fail('Choose a Monday for the week start.');
  if (start < monday()) fail('Choose the current week or a future week.');
  // A reusable strategy covers all seven weekdays, regardless of when it is
  // generated or which meals have already been recorded in the journal.
  const planning = structuredClone(req.student);
  planning.logs = [];
  planning.completedMeals = [];
  req.student.plan = generatePlan(planning, foods, targets(req.student.profile), start);
  await req.save(); res.json(await response(req));
});
app.use(express.static(path.join(root, 'public')));
app.use('/api', async (req, res) => res.status(404).json({ error: 'API route not found.' }));
app.use((err, req, res, next) => { if (!err.status || err.status >= 500) console.error(err); res.status(err.status || 500).json({ error: err.status && err.status < 500 ? err.message : 'Something went wrong. Please try again.' }); });
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  const host = process.env.HOST || '0.0.0.0';
  const server = app.listen(port, host, () => console.log(`NutriMess is ready at http://${host}:${server.address().port} (${storage.kind})`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => {
    const timer = setTimeout(() => process.exit(1), 10000);
    timer.unref();
    server.close(async () => { await storage.close(); clearTimeout(timer); process.exit(0); });
  });
}
