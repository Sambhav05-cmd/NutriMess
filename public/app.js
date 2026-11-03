const $ = (q, root = document) => root.querySelector(q);
const app = $('#app'), dialog = $('#dialog');
const debug=window.NutriMessDebug||{enabled:false,log:message=>console.debug('[NutriMess]',message),fail:message=>console.error('[NutriMess]',message),ready:()=>{}};
debug.log('App script executing');
const slotNames = ['breakfast', 'lunch', 'dinner', 'snacks'];
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const shortDays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
let authOptions, authMode = 'login', strategyDraft;
let state, catalog, report, colleges, foodMap, view = 'overview', selectedDay = 0, weekStart, journalDate, menuDraft, profileDraft, picker, mealDraft, busy = false;
const paths = {
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M7 3v4m10-4v4M3 11h18m-14 4h2m4 0h2m-8 3h2"/>',
  menu: '<path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18m10-18c-3 3-3 7 0 9h3V3h-3Zm3 9v9"/>',
  journal: '<path d="M5 3h14a1 1 0 0 1 1 1v17H6a2 2 0 0 1-2-2V4a1 1 0 0 1 1-1Zm0 14h15M9 7h7m-7 4h5"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v1"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14m-7-7h14"/>',
  leaf: '<path d="M20 3C7 1 1 10 7 17s15 0 13-14Zm-2 3L5 20m7-8v-5m0 5h5"/>',
  spark: '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3Z"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  refresh: '<path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5m-4 8a8 8 0 0 0 14 3l3-3m0 5v-5h-5"/>'
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.leaf}</svg>`;
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const fmt = (n, digits = 0) => Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: digits });
const pct = (value, target) => Math.max(0, Math.min(100, Math.round((value || 0) / target * 100)));
const shift = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0,10); };
const pretty = (date, options = { day: 'numeric', month: 'short' }) => new Date(`${date}T12:00:00Z`).toLocaleDateString('en-IN', options);
const food = id => foodMap.get(id);
const wholePortions = f => (f.portionStep ?? (/\b(bowl|katori)\b/i.test(f.serving || '') ? .5 : 1)) === 1;
const foodValue = (f, key, portions = 1, digits = 0) => f.nutrients[key] === null ? 'Unknown' : fmt(f.nutrients[key] * portions, digits);
function nutritionModelDetails(f) {
  const m=f.nutritionModel;if(!m||f.fallbackNutrients?.length===0)return '';
  const notes=[['Ingredients per 100 g',m.ingredients],['Cooking assumption',m.cookingMethod],['Cooking and yield',m.cookingNote],['Fortification assumption',m.fortification],['Vitamin A calculation',!f.fallbackNutrients||f.fallbackNutrients.includes('vitaminA')?m.vitaminAMethod:null],['Vitamin E review',!f.fallbackNutrients||f.fallbackNutrients.includes('vitaminE')?m.vitaminEReview:null],['Macro review',!f.fallbackNutrients||['calories','protein','carbs','fat'].some(k=>f.fallbackNutrients.includes(k))?m.macroReview:null],['Vitamin D zero',!f.fallbackNutrients||f.fallbackNutrients.includes('vitaminD')?m.vitaminDZero:null],['Vitamin B12 zero',!f.fallbackNutrients||f.fallbackNutrients.includes('b12')?m.vitaminB12Zero:null],['Model cautions',m.cautions]];
  return `<details><summary>Model assumptions and revisions</summary><p class="inline-note">These assumptions apply to uploaded fallback values; matching IFCT/USDA values take priority.</p>${notes.filter(([,v])=>v).map(([label,value])=>`<p class="inline-note"><strong>${esc(label)}:</strong> ${esc(value)}</p>`).join('')}</details>`;
}
function foodNutritionDetails(f) {
  const values = [...Object.entries(state.nutrients).map(([k, n]) => ({ ...n, key:k, name:k==='vitaminK'&&f.partialNutrients?.includes(k)?'Vitamin K1 · partial vitamin K':n.name, value: f.nutrients[k], source:f.nutrientSources?.[k]?.source||f.source, sourceType:f.nutrientSources?.[k]?.type })), ...Object.values(f.additionalNutrients||{})];
  return `<details class="food-nutrition"><summary>Nutrition per serving · ${f.planningEligible!==false?'reference estimate':'unavailable'}</summary><p class="inline-note">${esc(f.serving)}. ${esc(f.basis)}${f.menuCount?` Menu lists ${f.menuCount} pieces; nutrition is for the serving above.`:''}</p>${f.portion?`<p class="inline-note">Portion evidence: ${esc(f.portion.evidence.replaceAll('_',' ').toLowerCase())}. ${esc(f.portion.explanation)}${f.portion.rangeLowGrams!==null&&f.portion.rangeHighGrams!==null?` Typical range: ${fmt(f.portion.rangeLowGrams)}–${fmt(f.portion.rangeHighGrams)} g.`:''}</p>`:''}<div class="table-wrap"><table class="food-table"><thead><tr><th>Nutrient</th><th>Per listed serving</th><th>Value source</th></tr></thead><tbody>${values.map(n=>`<tr><td>${esc(n.name)}</td><td>${n.value===null?'Unknown':`${fmt(n.value,2)} ${esc(n.unit)}${n.value===0&&f.nutritionModel&&n.sourceType!=='dataset'&&['vitaminD','b12'].includes(n.key)?' · modeled zero':''}`}</td><td>${esc(n.source||f.source)}</td></tr>`).join('')}</tbody></table></div>${nutritionModelDetails(f)}<p class="inline-note">${esc(f.source)}${f.confidence?` · ${esc(f.confidence.replaceAll('_',' ').toLowerCase())}`:''}${[...new Set([...(f.sourceUrls||(f.sourceUrl?[f.sourceUrl]:[])),...(f.portionSourceUrls||[]),...(f.vitaminSourceUrls||[]),...(f.modelSourceUrls||[])])].map((url,i)=>` · <a href="${esc(url)}" target="_blank" rel="noreferrer">Source ${i+1} ↗</a>`).join('')}</p></details>`;
}
const foodEmoji = () => '';
function total(entries) { return entries.reduce((s, e) => { const f = food(e.foodId); for (const k in state.nutrients) s[k] = (s[k] || 0) + (f?.nutrients[k] || 0) * e.portions; return s; }, {}); }
function toast(message, error = false) { const el = $('#toast'); el.textContent = message; el.className = `show${error ? ' error' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className = '', 4300); }
async function api(path, method = 'GET', body) {
  const route=`/api/${path.split('?')[0]}`,start=performance.now(),controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),30000);
  debug.log(`${method} ${route} started`);
  try {
    const res = await fetch(`/api/${path}`, { method, signal:controller.signal, headers: {...(body?{'Content-Type':'application/json'}:{}),...(debug.enabled?{'X-NutriMess-Debug':'1'}:{})}, body: body ? JSON.stringify(body) : undefined });
    const requestId=res.headers.get('X-Request-ID');
    debug.log(`${method} ${route} headers: ${res.status}${requestId?` · request ${requestId}`:''}`);
    const data = await res.json();
    debug.log(`${method} ${route} complete · ${Math.round(performance.now()-start)}ms`);
    if (!res.ok) { const error = new Error(data.error || 'Request failed.'); error.status = res.status; throw error; }
    return data;
  } catch(error) {
    const failure=error.name==='AbortError'?new Error(`${method} ${route} timed out after 30 seconds. Please try again.`):error;
    if(failure.status!==401)debug.fail(`${method} ${route} failed: ${failure.message}`);
    throw failure;
  } finally {clearTimeout(timeout);}
}
async function mutate(path, method, body, message) {
  if (busy) return;
  busy = true;
  try { state = await api(path, method, body); dialog.close(); render(); if (message) toast(message); return true; }
  catch (e) { if (e.status === 409) { try { state = await api('state'); render(); } catch { /* Keep the original conflict message if refresh fails. */ } } toast(e.message, true); return false; } finally { busy = false; }
}
function renderAuth() {
  const register=authMode==='register';
  app.innerHTML=`<main class="auth-shell"><section class="card auth-card"><a class="brand" href="#"><img src="/favicon.svg" alt=""><span>NutriMess<small>A BETTER PLATE</small></span></a><h1>${register?'Create your account':'Welcome to NutriMess'}</h1><p class="subtext">Your mess menu, saved strategies, and daily nutrition in one place.</p><form id="auth-form"><label class="field">Email<input type="email" name="email" autocomplete="username" maxlength="254" required></label><label class="field">Password<input type="password" name="password" maxlength="128" autocomplete="${register?'new-password':'current-password'}" required></label>${register?`<label class="field">Your name<input name="name" maxlength="60" autocomplete="name" required></label><label class="field">Gender<select name="gender"><option value="female">Female</option><option value="male">Male</option></select></label><label class="field">College / hostel mess<select name="collegeId"><option value="custom">My own hostel · edit sample menu</option>${authOptions.colleges.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></label><p class="small-note">Start with editable reference height and weight: female 151 cm / 55 kg, male 163 cm / 65 kg. Age starts at 21. These are reference defaults, not measured vitals. <a href="${esc(authOptions.reference)}" target="_blank" rel="noreferrer">Source ↗</a></p><p class="small-note">Your initial plan is prepared in the background after signup. Once ready, it covers completed unlogged meals from its activation date. You can activate another strategy at any time.</p>`:''}<p id="auth-error" role="alert"></p><button type="submit" class="btn primary">${register?'Create account':'Log in'}</button></form><button class="btn ghost mt" data-action="auth-${register?'login':'register'}">${register?'Already have an account? Log in':'New here? Create an account'}</button></section></main>`;
}
async function submitAuth(form) {
  const mode=authMode, button=$('[type="submit"]',form), label=button.textContent;button.disabled=true;button.textContent=mode==='register'?'Creating account…':'Signing in…';
  try {const body=Object.fromEntries(new FormData(form));await api(`auth/${mode}`,'POST',body);view=mode==='register'?'profile':'overview';location.hash=view;await init();}
  catch(e){$('#auth-error',form).textContent=e.message;button.disabled=false;button.textContent=label;}
}
let initialPlanTimer, initialPlanEpoch=0;
function stopInitialPlanWatch(){clearTimeout(initialPlanTimer);initialPlanEpoch++;}
function initialPlanMessage(){
  return state?.initialPlan?.status==='pending'?'Preparing your initial weekly plan. This may take up to 30 seconds. You can use your account while it runs.':state?.initialPlan?.status==='failed'?'Your account is ready. Initial planning could not finish; you can generate a plan from Weekly planner.':'';
}
function watchInitialPlan(){
  if(state?.initialPlan?.status!=='pending')return;
  const epoch=initialPlanEpoch;
  initialPlanTimer=setTimeout(async()=>{
    try {
      const updated=await api('state');
      if(epoch!==initialPlanEpoch||!state)return;
      state=updated;
      const notice=$('#initial-plan-status');if(notice)notice.textContent=initialPlanMessage();
      if(state.initialPlan?.status==='ready'){
        toast('Your initial weekly plan is ready.');
        if(!profileDraft&&!menuDraft&&!strategyDraft&&!dialog.open&&!document.activeElement?.matches('input,select,textarea'))render();
      }
    }catch(error){if(epoch!==initialPlanEpoch||error.status===401)return;}
    if(epoch===initialPlanEpoch)watchInitialPlan();
  },2000);
}
function collegeSource(id) {
  const c=colleges.find(c=>c.id===id);
  if(!c?.sourceUrl)return c?.example?'Illustrative sample menu. Replace it with your actual hostel menu.':'Your own menu template.';
  return `${esc(c.status)} <a href="${esc(c.sourceUrl)}" target="_blank" rel="noreferrer">Menu source ↗</a> · reviewed ${esc(c.reviewedAt)}`;
}
function strategyNutrition(strategy) {
  return `<details class="strategy-nutrition mt"><summary>View nutrition stats</summary><p class="small-note">Calculated from the selected foods and portions using the current catalog and your saved profile targets. These are planned amounts.</p><div class="toolbar mt"><label class="field">Period<select data-strategy-nutrition-period><option value="week">Whole week</option>${days.map((day,i)=>`<option value="${i}">${day}</option>`).join('')}</select></label><label class="field">Meal<select data-strategy-nutrition-meal><option value="all">All meals</option>${slotNames.map(meal=>`<option value="${meal}">${meal}</option>`).join('')}</select></label></div><div class="strategy-nutrition-body">${strategyNutritionValues(strategy)}</div></details>`;
}
function strategyNutritionValues(strategy, period='week', meal='all') {
  const selected=period==='week'?strategy.days:[strategy.days[Number(period)]];
  const entries=selected.flatMap(day=>day.entries).filter(e=>e.portions>0&&(meal==='all'||e.meal===meal));
  const values=total(entries), multiplier=period==='week'?7:1;
  return `<p class="small-note">${period==='week'?'Weekly totals · targets are 7 × daily targets':`${days[Number(period)]} totals · daily targets`}${meal==='all'?'':` · ${esc(meal)} only; compared with the full ${period==='week'?'weekly':'daily'} target`}. ${entries.length?'':'No foods selected.'}</p><div class="table-wrap"><table class="food-table strategy-nutrition-table"><thead><tr><th>Nutrient</th><th>Planned amount</th><th>Planning target</th><th>Target coverage</th></tr></thead><tbody>${Object.entries(state.nutrients).map(([k,n])=>{
    const unknown=entries.some(e=>food(e.foodId)?.nutrients[k]==null||food(e.foodId)?.partialNutrients?.includes(k));
    const noData=entries.length>0&&entries.every(e=>food(e.foodId)?.nutrients[k]==null);
    const modeled=entries.some(e=>{const f=food(e.foodId);return f?.nutritionModel&&f.nutrients[k]!=null&&(!f.fallbackNutrients||f.fallbackNutrients.includes(k));});
    return `<tr data-nutrient="${esc(k)}"><td>${esc(n.name)}${unknown?'<span class="badge-unknown"> · incomplete data</span>':''}${modeled?'<span class="badge-unknown"> · modeled estimate</span>':''}</td><td>${noData?'Unknown':`${fmt(values[k],1)} ${esc(n.unit)}`}</td><td>${fmt(state.targets[k]*multiplier,1)} ${esc(n.unit)}</td><td>${noData?'No values available':unknown?'Known subtotal only · coverage unverified':`${fmt(values[k]/(state.targets[k]*multiplier)*100,1)}%`}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
function formatPlanScore(score) {
  if(!score?.experimental || score.value>=.05 || !Number.isFinite(score.logScore))return fmt(score?.value,1);
  const log10=(Math.log(100)+score.logScore)/Math.LN10;
  const exponent=Math.floor(log10);
  return `${(10**(log10-exponent)).toFixed(2)}e${exponent}`;
}
function strategyScoreDetails(score) {
  if(!score)return '';
  return `<section class="strategy-score mt"><strong>Strategy score: ${formatPlanScore(score)} / 100</strong>${score.experimental?'<p class="small-note">Gaussian scoring · stronger calorie penalty active.</p>':''}<p class="small-note">Higher is better · nutrient shortfalls and calorie excess. Calories at or below target have no score effect. This is a plan comparison score.${score.incomplete.length?' Some nutrient data is incomplete.':''}</p>${score.overrides.length?`<details><summary>${score.overrides.length} planning rule exceptions / overrides</summary><ul>${score.overrides.map(issue=>`<li>${days[issue.day]} ${esc(issue.meal)}: ${esc(issue.message)}</li>`).join('')}</ul></details>`:'<p class="small-note">Meets your current portion and food-group rules.</p>'}</section>`;
}
const planningGroupName=group=>({A:'Carb base group',B:'Curry group',C:'Group C · optional'})[group];
const planningGroupText=text=>text.replace(/group A/g,'carb base group').replace(/group B/g,'curry group');
function currentPlanningRules() {
  const rules=state.planningRules||{minimums:{roti:2,dosa:1,paratha:1,idli:2},requireGroups:true,groupMinimumA:1,groupMinimumB:1,dailyMilk:true,dailyCurd:true,consistentPortions:false,foodBounds:[],overrides:[]};
  return {...rules,foodBounds:(rules.foodBounds||[]).filter(row=>state.menu.some(day=>(row.meal==='all'?slotNames.flatMap(m=>day[m]):day[row.meal]||[]).includes(row.foodId)))};
}
function foodPlanningGroup(f){return currentPlanningRules().overrides.find(row=>row.foodId===f.id)?.group||f.planningGroup||'C';}
function planningRulesForm(){
  const rules=currentPlanningRules();
  return `<details class="card mt"><summary>Planning rules · change minimum portions and food groups</summary><form id="planning-rules-form"><p class="small-note">These rules apply to carb base and curry dishes in generated plans. Group C has no food/group minimum. You can override the rules when editing a strategy. Exclusions and meal attendance still apply. A missing carb base or curry option is flagged in the plan. Daily milk and curd add one listed serving at breakfast and lunch, even if absent from the menu, using another attended meal if needed. Exclusions and dairy-free settings take precedence. Before planning, choose per-food min/max limits. Quantities can vary across days.</p><div class="form-grid">${Object.entries(rules.minimums).map(([type,value])=>`<label class="field">Minimum ${esc(type)} pieces when offered<input name="minimum-${type}" type="number" min="0" max="5" step="1" value="${value}" required></label>`).join('')}<label class="check-label field full"><span><input name="requireGroups" type="checkbox" ${rules.requireGroups?'checked':''}>Require a carb base and a curry in each meal where available</span></label>${[["dailyMilk","One glass of milk every day"],["dailyCurd","One bowl of curd every day"]].map(([key,label])=>`<label class="check-label field full"><span><input name="${key}" type="checkbox" ${rules[key]!==false?'checked':''}>${label}</span></label>`).join('')}${['A','B'].map(group=>`<label class="field">Minimum listed servings of one ${planningGroupName(group).toLowerCase()} dish<input name="groupMinimum${group}" type="number" min="0" max="5" step="0.5" value="${rules[`groupMinimum${group}`]}" required></label>`).join('')}</div><p class="small-note">Carb base group: classified staples such as roti, dosa, idli, rice, poha, vada and paratha. Curry group: classified sabjis, dal, sambar and rasam. Group C: no group minimum. Initially only recognized NITK dishes are classified as carb bases or curries. Change a food’s group in <a href="#nutrition">Menu items nutrition stats</a>. Set a minimum to 0 to disable it. Bundled servings count their listed number of pieces.</p><button class="btn primary mt" type="submit">Save planning rules</button></form></details>`;
}
function strategiesPage() {
  const active=state.activations.at(-1);
  return `${heading('Plans you can return to.', 'Save a suggestion, create your own strategy, and log it whenever you eat.', '<button class="btn primary" data-action="strategy-new">+ Create my own plan</button>')}
    <section class="card" data-strategy-stats="active"><h2>Missed meals follow your active strategy</h2><p class="subtext">Active: <strong>${esc(active?.name||'None')}</strong>${active?` · since ${esc(active.from)}`:''}. It repeats by weekday. Estimates appear after 10:00 breakfast, 15:00 lunch, 18:00 snacks and 22:00 dinner (India time). Actual meal logs override estimates. Saving an empty meal records a skip.</p><p class="small-note">Editing a saved strategy does not change the active version. Activate the updated strategy to use it from today. Assumptions remain estimates and do not establish what you ate.</p>${strategyScoreDetails(state.activeStrategyScore)}${active?strategyNutrition(active):''}</section>
    ${strategyDraft?`<form id="strategy-form" class="card mt"><h2>${strategyDraft.id?'Edit strategy':'Create a strategy'}</h2><label class="field">Strategy name<input id="strategy-name" value="${esc(strategyDraft.name)}" maxlength="80" required></label><label class="field">Notes / approach<textarea id="strategy-notes" maxlength="2000">${esc(strategyDraft.notes)}</textarea></label><div class="strategy-days">${strategyDraft.days.map((d,i)=>`<section class="strategy-day"><h3>${days[i]}</h3>${slotNames.map(m=>`<div class="strategy-meal"><strong>${m}</strong><p class="subtext">${d.entries.filter(e=>e.meal===m).map(e=>`${fmt(e.portions,2)} × ${esc(food(e.foodId).name)}`).join(', ')||'No foods selected'}</p><button class="btn small" type="button" data-action="strategy-meal" data-day="${i}" data-meal="${m}">Edit meal</button></div>`).join('')}</section>`).join('')}</div><div data-strategy-stats="draft"><button class="btn mt" type="button" data-action="strategy-score">Calculate draft score</button><div id="draft-strategy-score"></div>${strategyNutrition(strategyDraft)}</div><div class="form-footer"><button class="btn" type="button" data-action="strategy-cancel">Discard draft</button><button class="btn primary" type="submit">Save strategy</button></div></form>`:''}
    <div class="section-heading"><h2>Your saved strategies</h2><span class="subtext">${state.strategies.length} saved</span></div>${state.strategies.map(s=>`<article class="card mt" data-strategy-stats="${esc(s.id)}"><h2>${esc(s.name)}</h2><p class="subtext">${esc(s.notes)}</p><p class="small-note">Updated ${pretty(s.updatedAt.slice(0,10))} · ${s.days.reduce((n,d)=>n+d.entries.length,0)} food selections</p>${strategyScoreDetails(state.strategyScores?.[s.id])}${strategyNutrition(s)}<div class="toolbar"><button class="btn" data-action="strategy-edit" data-id="${s.id}">Edit</button><button class="btn primary" data-action="strategy-activate" data-id="${s.id}">Use for missed meals</button><button class="btn" data-action="strategy-log" data-id="${s.id}">Log a meal</button><a class="btn" href="/api/strategies/${s.id}/pdf" download>Download PDF ↓</a><button class="btn ghost" data-action="strategy-delete" data-id="${s.id}">Delete</button></div></article>`).join('')||'<section class="card empty">No saved strategies yet. Create your own or save a suggestion from the weekly planner.</section>'}`;
}
function navButton(id, name, ico) { return `<button data-view="${id}" class="${view === id ? 'active' : ''}" ${view === id ? 'aria-current="page"' : ''} title="${name}">${icon(ico)}<span>${name}</span></button>`; }
const titles = { overview: 'Overview', planner: 'Weekly planner', menu: 'Mess menu', nutrition: 'Menu items nutrition stats', analysis: 'Food analysis', journal: 'Log meals', profile: 'Your profile', strategies: 'Saved strategies', about: 'How it works' };
function render() {
  app.innerHTML = `<div class="shell"><aside class="sidebar"><a class="brand" href="#overview"><img src="/favicon.svg" alt=""><span>NutriMess<small>A BETTER PLATE</small></span></a><div class="nav-label">YOUR EVERYDAY NUTRITION</div><nav class="nav" aria-label="Main navigation">${navButton('overview','Overview','grid')}${navButton('planner','Weekly planner','calendar')}${navButton('menu','Mess menu','menu')}${navButton('analysis','Food analysis','spark')}${navButton('journal','Log meals','journal')}${navButton('strategies','Saved strategies','leaf')}</nav><div class="side-bottom"><div class="side-note"><span class="leaf"></span><strong>Small choices. Better days.</strong>A little balance goes a long way, even in hostel life.</div><nav class="nav" aria-label="Settings">${navButton('about','How it works','info')}${navButton('profile','Your profile','user')}</nav></div></aside><div class="main-wrap"><header class="topbar"><div class="breadcrumb">Your space <span> / </span><strong>${titles[view]}</strong></div><div class="mobile-brand"><img src="/favicon.svg" alt="">NutriMess</div><div class="top-actions"><span class="pill">Your nutrition companion</span><button class="btn small" data-action="logout">Log out</button><span class="pill">${icon('leaf')} Vegetarian, thoughtfully planned</span><button class="avatar" data-view="profile" aria-label="Open your profile">${esc(state.profile.name.slice(0,2).toUpperCase())}</button></div></header><main class="content" id="main"><p id="initial-plan-status" class="small-note" role="status">${initialPlanMessage()}</p>${({ overview: overviewPage, planner: plannerPage, menu: menuPage, nutrition: menuNutritionPage, analysis: foodAnalysisPage, journal: journalPage, profile: profilePage, about: aboutPage, strategies: strategiesPage })[view]() }<footer class="footer"><span>Made for hostel life. Rooted in better nutrition.</span><a href="#about">IFCT 2017 · Data & methodology ↗</a></footer></main></div></div>`;
}
function heading(title, subtitle, action = '') { return `<div class="page-head"><div><h1>${title}</h1><p class="subtext">${subtitle}</p></div>${action || `<span class="date-badge">${icon('calendar')}${pretty(state.today, { weekday: 'long', day: 'numeric', month: 'short' })}</span>`}</div>`; }
function overviewPage() {
  const t = state.targets, actual = state.todayTotals;
  const weeklyLogs = [...state.logs,...state.estimatedLogs].filter(l => l.date >= state.weekStart && l.date <= state.today);
  const weekly = total(weeklyLogs), recent = state.logs.filter(l => l.date === state.today).slice(-3).reverse();
  return `${heading(`Eat well. Feel ready.`, `A little planning for a healthier hostel life, ${esc(state.profile.name)}.`)}
    <section class="hero"><div class="hero-copy"><div class="eyebrow">YOUR MENU. YOUR GOALS. YOUR BALANCE.</div><h2>Good nutrition.<br>Even on a mess menu.</h2><p>Make the most of what’s on your plate. A vegetarian plan that fits your week, and you.</p><button class="btn primary" data-view="planner">Plan my week ${icon('arrow')}</button></div><img src="/plate.svg" alt="Illustration of a balanced vegetarian plate with grains, vegetables, chickpeas and paneer"></section>
    ${state.todayUnknown?.some(k=>['calories','protein','carbs','fat'].includes(k))?'<p class="warning">Today’s totals include only known nutrient values. Some logged or assumed foods have unknown nutrition.</p>':''}<div class="section-heading"><h2>Today, on your plate</h2><span class="subtext">Logged + assumed intake · ${pretty(state.today)}</span></div>
    <div class="macro-grid"><article class="card macro-card cal-card"><div><div class="macro-label">${icon('spark')} Calories</div><div class="macro-value">${fmt(actual.calories)} <span>/ ${fmt(t.calories)}</span></div><div class="macro-detail">kcal · estimated maintenance</div></div><div class="ring" style="--progress:${pct(actual.calories,t.calories)}%"><span>${pct(actual.calories,t.calories)}%</span></div></article>
    ${[['protein','Protein','#789a66'],['carbs','Carbs','#daa36b'],['fat','Healthy balance · Fat','#9a9bc1']].map(([k,label,color]) => `<article class="card macro-card"><div class="macro-label"><span class="macro-dot" style="background:${color}"></span>${label}</div><div class="macro-value">${fmt(actual[k])}<span> g / ${fmt(t[k])} g</span></div><div class="track" style="--bar:${color};--progress:${pct(actual[k],t[k])}%"><div></div></div><div class="macro-detail">${actual[k] >= t[k] ? 'Target reached' : `${fmt(Math.max(0,t[k]-actual[k]))} g to your planning target`}</div></article>`).join('')}</div>
    <div class="two-col"><section class="card"><div class="card-head"><h2>The bigger picture</h2><span class="pill">This week</span></div><p class="subtext">Micronutrients add up, one meal at a time.</p><div class="nutrient-list">${['vitaminA','vitaminC','calcium','iron','folate'].map((k,i) => nutrientBar(k, weekly[k] || 0, t[k]*7, ['#6f9360','#d9a166','#8eac9b','#b49b70','#a5ad7b'][i])).join('')}</div><p class="small-note">${weeklyLogs.length ? `${weeklyLogs.length} food entries logged or assumed this week.` : 'Your week starts with your first food log.'} Percentages compare logged and assumed intake with seven daily targets.</p><button class="btn ghost mt" data-view="journal">Explore nutrition stats ${icon('arrow')}</button></section>
    <section class="card"><div class="card-head"><h2>Log meals</h2><button class="btn ghost small" data-action="log-open">${icon('plus')} Log food</button></div><p class="subtext">A real picture of what you eat.</p>${recent.length ? recent.map(l => journalRow(l)).join('') : `<div class="empty"><div class="empty-icon"></div><strong>Your plate has a story.</strong>Log your first meal to start tracking your daily<br>macros and weekly nutrient coverage.<br><button class="btn" data-action="log-open">${icon('plus')} Add your first food</button></div>`}<button class="btn ghost mt" data-view="journal">View meal log ${icon('arrow')}</button></section></div>
    <aside class="insight">${icon('leaf')}<div><strong>Different nutrients, different timelines</strong><p>Log meals now uses sourced turnover references for supported vitamins. B12’s reference loss is much slower than thiamin’s. Calories use a daily budget. See each nutrient’s evidence and limitations in <a href="#about">How it works</a>.</p></div></aside>`;
}
function nutrientBar(k, value, target, color = '#789b66', unknown = false) { return `<div class="nutrient-row"><span>${esc(state.nutrients[k].name)}</span><div class="track" style="--bar:${color};--progress:${pct(value,target)}%"><div></div></div><span>${unknown ? 'N/A' : `${pct(value,target)}%`}</span></div>`; }
function journalRow(l, remove = false) { const f = food(l.foodId); return `<div class="meal-row"><div class="food-icon">${foodEmoji(f)}</div><div class="meal-info"><strong>${esc(f.name)}</strong><span>${esc(l.meal)} · ${fmt(l.portions,1)} × ${esc(f.serving)}</span></div><span class="subtext">${foodValue(f,'calories',l.portions)} kcal</span>${remove ? `<button class="icon-btn" data-action="log-delete" data-id="${l.id}" aria-label="Delete ${esc(f.name)} entry">×</button>` : ''}</div>`; }
function dayTabs() { return `<div class="week-days" role="group" aria-label="Select day">${days.map((d,i) => { const date=shift(weekStart,i); return `<button class="day-tab ${selectedDay === i ? 'active' : ''}" data-action="day" data-day="${i}" aria-pressed="${selectedDay===i}">${shortDays[i]}<strong>${new Date(`${date}T12:00:00Z`).getUTCDate()}</strong>${pretty(date,{month:'short'})}${date===state.today?'<span class="today-mark">TODAY</span>':''}</button>`; }).join('')}</div>`; }
function plannerPage() {
  const plan = state.plan?.start === weekStart ? state.plan : null;
  const chosenDate = shift(weekStart, selectedDay), day = plan?.days[selectedDay];
  return `${heading('A balanced week starts here.', 'Your available meals, portioned around your nutrition goals.', `<button class="btn" data-action="extra-open">${icon('plus')} Add a day-only extra</button>`)}
    <section class="card"><div class="row space-between"><div><h2>${pretty(weekStart)} – ${pretty(shift(weekStart,6),{day:'numeric',month:'short',year:'numeric'})}</h2><p class="subtext">${esc(state.collegeName)} · ${plan ? 'Full seven-day suggestion' : 'Ready when you are'}</p></div><div class="toolbar"><label class="visually-hidden" for="week-start">Week starting Monday</label><input id="week-start" class="date-input" type="date" value="${weekStart}" min="${state.weekStart}"><button class="btn primary" data-action="generate">${icon(plan?'refresh':'spark')}${plan?'Regenerate':'Build my plan'}</button></div></div>${dayTabs()}<p id="plan-generation-status" class="inline-note" role="status" aria-live="polite" hidden></p><p class="subtext">Suggestions cover all seven days, including earlier weekdays. Only selected meals are planned. Your actual and assumed intake stays in the meal log.</p></section>
    ${planningRulesForm()}${plan?impactLegend()+strategyScoreDetails(plan.strategyScore):''}${!plan ? `<section class="card mt plan-empty empty"><div class="empty-icon"></div><strong>A plan built from your mess menu.</strong>Balance daily macros and weekly micronutrients around your calorie target.<br>Start with your <a href="#profile">profile</a> and <a href="#menu">meal availability</a>, then build your plan.<button class="btn primary" data-action="generate">${icon('spark')} Find my balance</button></section>` : `<div class="summary-strip mt">${['calories','protein','carbs','fat'].map(k=>`<div class="card"><span>${esc(state.nutrients[k].name)}</span><strong>${fmt(day.total[k])} <span>/ ${fmt(k==='calories'?plan.calorieCap:state.targets[k])} ${state.nutrients[k].unit}</span></strong></div>`).join('')}</div>
    ${day.warnings.map(w=>`<div class="warning">${esc(planningGroupText(w))}</div>`).join('')}${state.profile.calorieCap && state.profile.calorieCap < state.targets.calories ? '<div class="warning">Your calorie target is below estimated maintenance. This app does not prescribe a weight-loss diet; review a suitable target with a qualified professional.</div>' : ''}
    ${slotNames.map(meal=>{const entries=day.entries.filter(e=>e.meal===meal);return `<section class="card meal-section"><div class="meal-title"><h3>${icon(meal==='snacks'?'leaf':'menu')}${meal}</h3>${entries.length && chosenDate<=state.today ? `<button class="btn small" data-action="log-planned" data-meal="${meal}" data-date="${chosenDate}">${icon('check')} Log this meal</button>` : ''}</div>${entries.length ? `<div class="table-wrap"><table class="food-table"><thead><tr><th>On your plate</th><th>Portions</th><th>Energy</th><th>Protein</th></tr></thead><tbody>${entries.map(e=>{const f=food(e.foodId);return `<tr class="${planImpactClass(selectedDay,meal,e.foodId)}"><td><div class="food-name"><span>${foodEmoji(f)}</span><div>${esc(f.name)}<small>${esc(f.serving)}</small>${planImpact(selectedDay,meal,e.foodId)}</div></div></td><td>${fmt(e.portions,2)} ×</td><td>${foodValue(f,'calories',e.portions)} kcal</td><td>${foodValue(f,'protein',e.portions,1)} g</td></tr>`;}).join('')}</tbody></table></div>` : `<p class="notice">${day.loggedMeals.includes(meal)?'Recorded or assumed · included in the totals above.': !state.attendance[selectedDay][meal]?'Not selected for this day.': 'No portions selected within your current constraints. Try editing the menu or preferences.'}</p>`}</section>`;}).join('')}
    <div class="section-heading"><div><h2>Your weekly nutrient outlook</h2><p class="subtext">Suggested intake · compared with 7 × the daily target</p></div></div><div class="week-nutrient-grid">${Object.keys(state.nutrients).filter(k=>!['calories','protein','carbs','fat'].includes(k)).map(k=>`<article class="card"><div class="macro-label">${esc(state.nutrients[k].name)} ${plan.unknown.includes(k)?'<span class="badge-unknown">· incomplete data</span>':''}${plan.estimated?.includes(k)?'<span class="badge-unknown">· modeled estimate</span>':''}</div><div class="macro-value">${plan.noData?.includes(k)?'Unknown':fmt(plan.weekly[k],1)} <span>/ ${fmt(state.targets[k]*7)} ${esc(state.nutrients[k].unit)}</span></div><div class="track" style="--progress:${pct(plan.weekly[k],state.targets[k]*7)}%"><div></div></div><p class="macro-detail">${plan.noData?.includes(k)?'No values available for selected foods':plan.unknown.includes(k)?'Known subtotal only · coverage unverified':`${pct(plan.weekly[k],state.targets[k]*7)}% of weekly planning target`}</p></article>`).join('')}</div>${plan.availability?.unreachable.length?`<div class="warning"><strong>Some targets cannot be reached from this menu.</strong><p>Even allowing the configured maximum portions of every available dish, before applying calorie and nutrient upper limits, these weekly totals remain below target: ${plan.availability.unreachable.map(k=>`${esc(state.nutrients[k].name)}: at most ${fmt(plan.availability.maximum[k],2)} / ${fmt(state.targets[k]*7,1)} ${esc(state.nutrients[k].unit)}`).join('; ')}. These are optimistic bounds from recorded food values, not measured intake.</p></div>`:''}${plan.gaps.length?`<div class="warning"><strong>Room to improve:</strong> ${plan.gaps.map(k=>esc(state.nutrients[k].name)).join(', ')} are below 90% of the weekly target. Missing data can also cause apparent gaps. Your menu may not cover every nutrient.</div>`:''}<p class="small-note">Weekly suggestions are reusable planning estimates. Generating or saving a strategy does not log food.<br>${esc(plan.method)}. Soft calorie target: ${fmt(plan.calorieCap)} kcal/day. Nutrient upper limits are checked daily where implemented.</p>`}
    <section class="card mt"><h2>Make this plan yours</h2><p class="subtext">Save the suggestion as a reusable strategy, edit any meal, or start an empty plan.</p><div class="toolbar"><button class="btn primary" data-action="strategy-suggested" ${plan?'':'disabled'}>Edit & save suggested plan</button><button class="btn" data-action="strategy-new">Create my own plan</button><button class="btn" data-view="strategies">Saved strategies</button></div></section>${extrasList()}`;
}
function extrasList() { const entries=state.extras.filter(e=>e.date>=weekStart && e.date<=shift(weekStart,6)); return entries.length ? `<section class="card mt"><h2>Extras for this week</h2><p class="subtext">Available only on the specified date and meal. Adding an extra does not log it.</p><div class="chips">${entries.map(e=>`<span class="chip">${esc(food(e.foodId).name)} · ${pretty(e.date)} · ${e.meal}<button data-action="extra-delete" data-id="${e.id}" aria-label="Remove extra">×</button></span>`).join('')}</div></section>`:''; }
function menuPage() {
  if (!menuDraft) menuDraft = structuredClone({ menu: state.menu, attendance: state.attendance, collegeId:state.collegeId, collegeName:state.collegeName });
  return `${heading('Make the menu work for you.', 'Choose a saved college menu or build one from your own hostel.', '<div class="toolbar"><button class="btn" data-view="nutrition">Menu items nutrition stats</button><button class="btn primary" data-action="menu-save">Save menu & attendance</button></div>')}
    <section class="card"><div class="form-grid"><label class="field">Start with a college menu<select id="college-select"><option value="custom">My own weekly menu</option>${colleges.map(c=>`<option value="${esc(c.id)}" ${menuDraft.collegeId===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></label><label class="field">Your college / menu name<input id="college-name" value="${esc(menuDraft.collegeName)}" maxlength="100" required></label></div><div class="row space-between mt"><p class="subtext">${collegeSource(menuDraft.collegeId)}</p><button class="btn small" data-action="college-save">Save as a college template</button></div></section>
    <label class="check-label mt"><span><input id="menu-apply-all" type="checkbox" ${menuApplyAll?'checked':''}> Apply replacements/removals to this same food at this same meal on all days. Additions apply to all days of that meal.</span></label><div class="section-heading"><h2>Your weekly mess menu</h2><span class="subtext">Check the meals you’ll eat</span></div><div class="scroll-area"><div class="menu-grid">${days.map((day,i)=>`<section class="menu-day"><h3>${day}</h3>${slotNames.map(meal=>`<div class="menu-slot ${menuDraft.attendance[i][meal]?'':'off'}"><label class="check-label"><input type="checkbox" data-attendance="${i}" data-meal="${meal}" ${menuDraft.attendance[i][meal]?'checked':''}>${meal}</label>${menuDraft.menu[i][meal].map(id=>`<div class="menu-item"><span>${foodEmoji(food(id))} ${esc(food(id).name)}</span><button class="btn small" data-action="menu-replace" data-day="${i}" data-meal="${meal}" data-food="${esc(id)}">Replace</button><button class="icon-btn" data-action="menu-remove" data-day="${i}" data-meal="${meal}" data-food="${esc(id)}" aria-label="Remove ${esc(food(id).name)} from ${day} ${meal}">×</button></div>`).join('')}<button class="btn ghost small" data-action="menu-add" data-day="${i}" data-meal="${meal}">+ Add food</button></div>`).join('')}</section>`).join('')}</div></div><div class="form-footer"><button class="btn" data-action="menu-reset">Discard edits</button><button class="btn primary" data-action="menu-save">${icon('check')} Save menu & attendance</button></div><div class="insight">${icon('info')}<div><strong>Availability is different from a recommendation.</strong><p>The planner chooses portions from the foods available at each selected meal. Unchecked meals won’t be planned. Fruit, milk, or a canteen purchase can be added for just one date in the weekly planner.</p></div></div>`;
}
function menuNutritionPage() {
  const current=menuDraft||state;
  const ids=[...new Set(current.menu.flatMap(day=>slotNames.flatMap(meal=>day[meal])))];
  const items=ids.map(food).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name));
  const preset=colleges.find(c=>c.id===current.collegeId);
  return `${heading('Menu items nutrition stats', `${esc(current.collegeName)} · ${items.length} unique menu items. Values are per listed serving.`, '<button class="btn" data-view="menu">Back to mess menu</button>')}
    <section class="card"><p class="subtext">Each item appears once across the full week. Expand an item for all nutrients, sources and model assumptions. ${esc(preset?.mappingNote||'')}</p><div class="table-wrap"><table class="food-table menu-nutrition-table"><thead><tr><th>Menu item</th><th>Food group</th><th>Serving</th><th>Energy · kcal</th><th>Protein · g</th><th>Carbs · g</th><th>Fat · g</th><th>Fiber · g</th></tr></thead><tbody>${items.map(f=>`<tr data-nutrition-food="${esc(f.id)}"><td><strong>${esc(f.name)}</strong>${foodNutritionDetails(f)}</td><td><label class="visually-hidden" for="group-${esc(f.id)}">Food group for ${esc(f.name)}</label><select id="group-${esc(f.id)}" data-food-planning-group="${esc(f.id)}">${['A','B','C'].map(group=>`<option value="${group}" ${foodPlanningGroup(f)===group?'selected':''}>${planningGroupName(group)}</option>`).join('')}</select></td><td>${esc(f.serving)}</td>${['calories','protein','carbs','fat','fiber'].map(k=>`<td>${foodValue(f,k,1,2)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${items.length?'':'<p class="notice">Add foods to your mess menu to see their nutrition stats.</p>'}</section>`;
}
function journalPage() {
  journalDate ||= state.today;
  const logs=state.logs.filter(l=>l.date===journalDate), assumed=state.estimatedLogs.filter(l=>l.date===journalDate), values=total([...logs,...assumed]);
  return `${heading('Every plate counts.', 'Log what you actually ate. Your nutrition story grows from here.', '<button class="btn primary" data-action="log-open">'+icon('plus')+' Log food</button>')}
    <div class="journal-filters"><label class="field">View day<input type="date" id="journal-date" value="${journalDate}" max="${state.today}"></label><button class="btn" data-action="export">Export my data ↓</button></div>
    <div class="summary-strip">${['calories','protein','carbs','fat'].map(k=>`<div class="card"><span>${esc(state.nutrients[k].name)}</span><strong>${fmt(values[k])} <span>/ ${fmt(state.targets[k])} ${state.nutrients[k].unit}</span></strong></div>`).join('')}</div>
    <section class="card"><div class="card-head"><h2>${pretty(journalDate,{weekday:'long',day:'numeric',month:'long'})}</h2><span class="subtext">${logs.length} food entries</span></div>${slotNames.map(meal=>{const actual=logs.filter(l=>l.meal===meal), estimates=assumed.filter(l=>l.meal===meal), entries=actual.length?actual:estimates;return `<section class="journal-meal"><div class="meal-title"><h3>${meal}</h3><button class="btn small" data-action="meal-edit" data-date="${journalDate}" data-meal="${meal}">${entries.length?'Edit meal':'Log from menu'}</button></div>${estimates.length&&!actual.length?'<p class="inline-note">Assumed from active strategy · replace by logging what you ate.</p>':''}${entries.length?entries.map(l=>journalRow(l,!l.assumed)).join(''):'<p class="inline-note">No food recorded.</p>'}</section>`;}).join('')}</section>
    <section class="card mt"><div class="card-head"><h2>Nutrition over time</h2><span class="pill">As of ${pretty(state.today)}</span></div><p class="subtext">Logged and assumed intake, weighted with nutrient-specific turnover evidence. ${state.nutritionBaseline?'New accounts start at an assumed 100% history baseline. This baseline is saved once and is not reset by logging in.':'Initial body stores are unknown.'}</p><div class="history-grid mt">${Object.entries(state.intakeHistory).map(([k,h])=>{const e=state.turnoverEvidence.nutrients[k];return `<article class="history-item"><h3>${esc(state.nutrients[k].name)}</h3><strong>${h.assumedStart?`${fmt(h.historyCoverage*100,1)}% <small>history indicator</small>`:h.mode==='turnover'?`${fmt(h.retainedTargetDays,3)} <small>target-days</small>`:`${fmt(h.todayCoverage*100)}% <small>of today’s target</small>`}</strong><p>${h.mode==='turnover'?`${fmt((1-h.retentionPerDay)*100,3)}% reference loss/day · ${fmt(h.halfLifeDays,1)} day half-time`:'Daily reporting · no fixed body-decay rate'}</p>${h.unknownEntries?`<span class="badge-unknown">${h.unknownEntries} entries have unknown values · known contributions only</span>`:''}<p class="inline-note">${esc(e.summary)}${h.assumedStart?` Assumed start contribution: ${fmt(h.startingCoverage*100,1)}%; recorded intake: ${fmt(h.retainedTargetDays,3)} target-days.`:''}</p><a href="#about">Evidence & assumptions ↗</a></article>`;}).join('')}</div><p class="small-note">A target-day is one day’s recommended intake, capped at one contribution per logged day, then weighted by the reference retention rate. The history indicator combines recorded intake with an assumed starting baseline for new accounts, capped at 100%. The baseline follows the same reference decay or daily reporting reset; it does not add food logs or establish biological stores. Existing accounts without a baseline continue to show recorded contributions. Completed unlogged meals follow the active strategy; meals outside its coverage remain unknown. Empty saved meal logs explicitly record a skipped meal. Missing nutrient values never establish deficiency.</p></section>`;
}
function profilePage() {
  profileDraft ||= structuredClone(state.profile); const p=profileDraft;
  return `${heading('A plan that starts with you.', 'Your body, your routine, your food preferences.')}
    <div class="warning profile-alert">For general planning for adults aged 19–30, excluding pregnancy and lactation. Targets are estimates, not a clinical prescription. Weekly totals do not establish nutritional adequacy.</div>
    <div class="profile-grid"><form id="profile-form" class="card"><h2>Your everyday details</h2><div class="form-grid"><label class="field full">What should we call you?<input name="name" value="${esc(p.name)}" maxlength="60" required autocomplete="given-name"></label><label class="field">Age<input name="age" type="number" min="19" max="30" step="1" value="${p.age}" required></label><label class="field">Gender<select name="gender"><option value="male" ${p.gender==='male'?'selected':''}>Male</option><option value="female" ${p.gender==='female'?'selected':''}>Female</option></select></label><label class="field">Height · cm<input name="height" type="number" min="120" max="230" step="0.1" value="${p.height}" required></label><label class="field">Weight · kg<input name="weight" type="number" min="35" max="250" step="0.1" value="${p.weight}" required></label><label class="field full">Exercise & activity<select name="activity">${[['sedentary','Mostly sitting · little exercise'],['light','Light activity · exercise 1–3 days/week'],['moderate','Moderately active · exercise 3–5 days/week'],['active','Very active · exercise most days']].map(([v,l])=>`<option value="${v}" ${p.activity===v?'selected':''}>${l}</option>`).join('')}</select></label><label class="field full">Daily calorie target · optional<input name="calorieCap" type="number" min="1000" max="5000" value="${p.calorieCap??''}" placeholder="Automatic · estimated maintenance calories"><small>Leave blank to use estimated maintenance. Exceeding this target lowers the score but does not block a plan.</small></label><div class="field full"><span>Nutrient-specific turnover</span><small>Rates now come from saved scientific references, not one adjustable factor. See Nutrition over time in the journal and the evidence table in How it works.</small><a class="btn ghost" href="#about">View turnover data & sources ↗</a></div><label class="check-label field full"><span class="row"><input name="dairyFree" type="checkbox" ${p.dairyFree?'checked':''}>Avoid dairy and dishes containing it</span></label></div><div class="form-footer"><button class="btn primary" type="submit">Save profile & preferences ${icon('check')}</button></div></form>
    <div><section class="card"><div class="card-head"><h2>Your food preferences</h2><button class="btn ghost small" data-action="preference-open">+ Add</button></div><p class="subtext">Exclude ingredients or dishes. Favorites get a small planning bonus. Excluded ingredients also exclude recipes containing them.</p>${[...new Set([...p.preferred,...p.excluded])].length ? [...new Set([...p.preferred,...p.excluded])].map(id=>`<div class="preference-row"><span>${foodEmoji(food(id))}</span><strong>${esc(food(id).name)}</strong><select data-preference="${esc(id)}" aria-label="Preference for ${esc(food(id).name)}"><option value="preferred" ${p.preferred.includes(id)?'selected':''}>Favorite</option><option value="excluded" ${p.excluded.includes(id)?'selected':''}>Exclude</option><option value="neutral">No preference</option></select></div>`).join(''):'<div class="empty">No individual food preferences yet.<br>Add dishes or ingredients you love or avoid.</div>'}<p class="small-note">Recipe ingredients are estimates. For allergies, check the actual food preparation and cross-contact at your mess.</p></section><section class="card mt"><h2>Current planning targets</h2><p class="subtext">Calculated from your saved profile</p><div class="nutrient-list">${['calories','protein','carbs','fat'].map(k=>`<div class="row space-between"><span class="subtext">${state.nutrients[k].name}</span><strong>${fmt(state.targets[k])} ${state.nutrients[k].unit}</strong></div>`).join('')}</div><p class="small-note">Maintenance: Mifflin–St Jeor estimate × activity factor. Protein: 1.2 g/kg, or 1.6 g/kg for very active students. Fat: 28% of energy; carbohydrates fill the remainder.</p><a class="btn ghost mt" href="#about">See target sources ${icon('arrow')}</a></section></div></div>`;
}
function turnoverEvidenceSection() {
  const model=state.turnoverEvidence;
  return `<h2>Nutrient turnover: evidence, not one shared decay value</h2><p>Reference data reviewed ${esc(model.reviewedAt)} is saved with this app. The intake-history view sums recorded target-days after applying a nutrient-specific retention weight. It starts with no assumed body-store measurement. One target-day means one daily intake target, capped per logged day. It is not a claim that a serving was absorbed or stored.</p><p>For supported nutrients: <code>signal = Σ[min(recorded daily intake / target, 1) × retention^age in days]</code>. Retention is <code>1 − daily fractional loss</code> or <code>2^(−1 / half-life days)</code>. Missing completed meals use the active strategy where available, labeled as assumed intake. Daily-only nutrients show today’s recorded intake; a midnight budget reset is a reporting rule, not physical nutrient loss.</p><div class="table-wrap"><table class="food-table evidence-table"><thead><tr><th>Nutrient</th><th>Reference rate used</th><th>Evidence and model assumptions</th></tr></thead><tbody>${Object.entries(model.nutrients).map(([k,e])=>{const h=state.intakeHistory[k];return `<tr><td>${esc(state.nutrients[k].name)}</td><td>${h.mode==='turnover'?`${fmt((1-h.retentionPerDay)*100,3)}% loss/day<br>~${fmt(h.halfLifeDays,1)} day half-time`:'No fixed rate applied'}</td><td>${esc(e.summary)} ${esc(e.selection||e.reason||'')}<br>${e.sourceIds.map(id=>{const s=model.sources[id];return `<a href="${esc(s.url)}" target="_blank" rel="noreferrer">${esc(s.title)} ↗</a>`;}).join('<br>')}</td></tr>`;}).join('')}</tbody></table></div><p>The 24-day vitamin C and 13.5-day B1 coefficients are chosen midpoints of published ranges, not measured constants for you. The B6 coefficient has an explicit compartment limitation. Vitamin D’s circulating 25(OH)D half-life is saved as evidence but is not applied to dietary D2/D3. Minerals and other unsupported nutrients have no invented half-life. Initial stores, absorption, sunlight and disease are not inferred from food logs.</p>`;
}
function aboutPage() {
  return `${heading('A little science behind your plate.', 'Transparent data, useful estimates, and honest limits.')}<section class="card info-copy"><h2>Food data you can trace</h2><p>NutriMess imports ${report.ifctFoods} vegetarian foods from your supplied Indian Food Composition Tables 2017 dataset. Values refer to 100 g of edible ingredients, usually raw. Recipe dishes are estimates built from explicit ingredient weights, not lab measurements of your mess food. Added cooking water has no nutrients; cooking losses, salt, oil variation and actual portion yields are not fully modeled.</p><div class="dataset-status"><strong>Supplied USDA export · incomplete</strong><p>${esc(report.usda.message)}${report.usda.missing.length?` Missing files: ${report.usda.missing.map(esc).join(', ')}.`:''}</p><p>Separately, two official USDA SR Legacy dairy records were downloaded and saved locally: plain whole-milk yogurt (FDC 171284) and cheddar (FDC 173414). These include B12. Yogurt is a reference for curd; actual dahi varies. Choose cheese labeled suitable for vegetarians. Milk, paneer, khoa and ghee also use your IFCT data. All dairy is optional and can be excluded in your profile.</p></div><h2>Daily macros, weekly micronutrients</h2><p>The planner searches half portions for bowl/katori servings and whole portions for other foods, up to five servings per food per meal, within configured min/max limits. Configurable piece minimums and carb base / curry meal rules are enforced for suggestions; manual strategies may override them. ${state.scoringMode?.id==='gaussian'?'A bounded beam search scores squared relative nutrient gaps with a Gaussian objective and refines food quantities against the full weekly score.':'A bounded beam search uses exponential relative-gap penalties.'} Calories only incur a penalty above the calorie target; amounts at or below it give no benefit and no penalty. Protein, carbs and fat use daily shortfalls only; fiber, vitamins and minerals use weekly shortfalls only. Above-target nutrients earn no extra benefit and no score penalty. Existing nutrient upper limits still apply during planning. The search preserves nutrient specialists. Use the pre-planning dialog to set per-food min/max limits. Repeated foods can have different quantities across days. Optimizer search is capped at five portions per food per meal; manual edits can exceed this. You can disable these defaults in Planning rules. Coordinate refinement reduces weekly shortfalls. It penalizes calorie-target excess and respects selected meals, filters excluded ingredients and dairy, and adds a small bonus for favorite foods. This approximate method does not guarantee a global optimum or complete nutrition.</p><p>Selected micronutrient upper limits are checked each day. More intake beyond a weekly target earns no extra nutrient coverage score. Weekly targets are seven daily targets, used as a planning heuristic. They do not make it appropriate to take a week’s nutrients all at once. Reusable weekly suggestions cover all seven days independently of the meal log. Actual and assumed intake remains in the journal; logging a suggested meal does not overwrite existing entries.</p><h2>Missing values stay unknown</h2><p>B12 is absent from the supplied IFCT and INDB schemas. Saved USDA whole-milk, yogurt and cheese references supply B12 for compatible foods; other missing values remain unknown. A plan’s known subtotal does not establish coverage where values are missing. A food-only vegetarian menu may also struggle to cover vitamin D. The app reports gaps rather than inventing nutrients or prescribing supplements.</p>${messMenuEvidenceSection()}${indbEvidenceSection()}${turnoverEvidenceSection()}${referenceLibrarySection()}<h2>Targets & references</h2><p>General adult 19–30 reference values use sex-specific US Dietary Reference Intakes. Energy uses a Mifflin–St Jeor maintenance estimate and approximate activity multipliers. Protein and fat are configurable-in-code planning choices, not individualized treatment. Targets exclude pregnancy, lactation and medical conditions. Iron bioavailability, nutrient interactions and individual absorption are not modeled.</p><ul><li><a href="https://ods.od.nih.gov/healthinformation/nutrientrecommendations.aspx" target="_blank" rel="noreferrer">NIH Office of Dietary Supplements · Nutrient recommendations</a></li><li><a href="https://www.ncbi.nlm.nih.gov/books/NBK208874/" target="_blank" rel="noreferrer">National Academies · Dietary Reference Intake tables</a></li><li><a href="https://ifct2017.github.io" target="_blank" rel="noreferrer">IFCT dataset documentation</a> · supplied by Subhajit Sahu, AGPL-3.0-or-later; original measurements from NIN, Hyderabad.</li></ul><h2>Your data & this installation</h2><p>Accounts, profiles and logs are stored in the server database. This isolated experimental checkout always uses its own local SQLite database and never connects to Atlas. An HTTP-only session cookie identifies your account. Accounts use email and hashed passwords with expiring database sessions. Password recovery is not implemented. Use it on localhost. Add HTTPS and operational safeguards before offering it as a public multi-user service. Export your records from the meal log.</p></section>`;
}
function messMenuEvidenceSection() {
  const r=report.messMenu;if(!r)return '';
  if(r.activeSource==='revised-realistic-servings')return `<h2>NITK revised realistic servings</h2><p>All 96 foods currently use values from nitk_mess_96_foods_revised_realistic_servings.xlsx, sheet All Nutrients 96. These estimates include the revised serving weights and nutrient values directly. The weekly schedule and food IDs are unchanged. Other catalog foods keep their existing sources.</p><p><a href="/api/mess-menu/foods-source">Download the active nutrient CSV</a> · <a href="/api/mess-menu/source">Download weekly schedule</a></p>`;
  return `<h2>NITK uploaded mess menu</h2><p>The uploaded weekly menu contains ${r.rows} meal entries and ${r.dishes} distinct dishes. ${r.withNutrition} dishes have supplied macro estimates; ${r.withoutNutrition} lack macro data. Matching IFCT/USDA values take priority, normalized to the listed serving weight. The food CSV supplies nutrition per Indian household serving, and the weekly CSV supplies only meal availability. One portion uses the serving description and edible gram weight shown for each food, such as one idli or one katori. Counts in dish names describe the menu offering. Oats and cornflakes use dry weight. Portion evidence, typical weight ranges and source links are included where supplied. The current source fills tracked nutrients using published references, food proxies and recipe models. Vitamins A, D and B12 include modeled values. D/B12 zeros assume the stated ingredients and fortification; they are not measured absence. Vitamin K1 is a partial contribution to vitamin K. Nutrition details include sodium, phosphorus, niacin, B5 and free sugar alongside the nutrients tracked by the planner.</p><p>Values, portion assumptions and recipe cautions come from your supplied CSV. They have not been independently verified against actual mess preparation. <a href="/api/mess-menu/foods-source">Download food and serving source CSV</a> · <a href="/api/mess-menu/source">Download weekly menu CSV</a>.</p>`;
}
function indbEvidenceSection() {
  const r=report.indb;
  return `<h2>Supplemental Indian recipes</h2><p>The supplied INDB workbook adds ${r.addedRecipes} ingredient-screened vegetarian recipes and ${r.addedIngredients} ingredient references that are missing from the primary catalog. Existing IFCT foods, USDA dairy references, and NutriMess recipes keep their values. ${r.primaryMatches.length} overlapping recipes use an existing catalog record. <a href="${esc(r.sourceUrl)}" target="_blank" rel="noreferrer">INDB source and methodology ↗</a></p><p>INDB dishes are calculated recipe estimates. Source cooking-retention assumptions do not establish your mess’s exact nutrients. Native serving units are preserved where available; missing serving definitions use a clearly labeled 100 g portion. Ingredient quantities shown for INDB recipes describe the whole source batch, not one portion.</p><p>B12 and compatible vitamin A/E definitions remain unknown in these additions. Some source calculations substituted unknowns with zero; ambiguous micronutrient zeros and incomplete ingredient contributions are treated as unknown here. Generic cheese still requires vegetarian rennet. Trace macros are approximated as zero and identified in ingredient notes.</p><details><summary>${r.skipped.length} recipes withheld from import</summary><p>Non-vegetarian, ambiguous or unresolved ingredients and questionable oil/serving estimates are excluded.</p><div class="table-wrap"><table class="food-table"><thead><tr><th>Source code</th><th>Dish</th><th>Reason</th></tr></thead><tbody>${r.skipped.map(s=>`<tr><td>${esc(s.code)}</td><td>${esc(s.name)}</td><td>${esc(s.reason)}${s.ingredients?` · ${s.ingredients.map(esc).join(', ')}`:''}</td></tr>`).join('')}</tbody></table></div></details>`;
}
function referenceLibrarySection() {
  const library=report.referenceLibrary;
  return `<h2>Saved reference library</h2><p>${esc(library.scope)} Reviewed ${esc(library.reviewedAt)}. Reference tables, nutrient turnover evidence, and USDA dairy snapshots are also stored in SQLite.</p>${library.records.map(r=>`<details class="mt"><summary>${esc(r.title)} · ${esc(r.publisher)}</summary><p>${esc(r.note)} <a href="${esc(r.sourceUrl)}" target="_blank" rel="noreferrer">Source ↗</a></p><div class="table-wrap"><table class="food-table"><thead><tr>${r.columns.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${r.rows.map(row=>`<tr>${row.map(c=>`<td>${c===null?'—':esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div></details>`).join('')}<h2>Institutional menu sources</h2><p>These are partial catalog mappings from published tentative or sample menus. Confirm your current hostel availability before planning.</p><ul>${colleges.filter(c=>c.sourceUrl).map(c=>`<li><a href="${esc(c.sourceUrl)}" target="_blank" rel="noreferrer">${esc(c.name)}</a> · reviewed ${esc(c.reviewedAt)}. ${esc(c.mappingNote)}</li>`).join('')}</ul>`;
}
function openMealEditor(date=state.today,meal='breakfast') {
  const dayIndex=(new Date(`${date}T12:00:00Z`).getUTCDay()+6)%7;
  const logged=state.logs.filter(l=>l.date===date&&l.meal===meal);
  const planned=state.estimatedLogs.filter(e=>e.date===date&&e.meal===meal);
  if(!planned.length)planned.push(...(state.plan?.days.find(d=>d.date===date)?.entries.filter(e=>e.meal===meal)||[]));
  const menuIds=state.menu[dayIndex][meal];
  const extraIds=state.extras.filter(e=>e.date===date&&e.meal===meal).map(e=>e.foodId);
  const ids=[...new Set([...menuIds,...extraIds,...planned.map(e=>e.foodId),...logged.map(e=>e.foodId)])];
  const source=logged.length?logged:planned;
  mealDraft={date,meal,expectedLogIds:logged.map(l=>l.id),rows:ids.map(id=>{
    const amount=source.filter(e=>e.foodId===id).reduce((sum,e)=>sum+e.portions,0);
    return {foodId:id,portions:amount||1,selected:amount>0,origin:menuIds.includes(id)?'Mess menu':extraIds.includes(id)?'Day-only extra':'Off menu'};
  })};
  picker=null;renderMealEditor();
}
function renderMealEditor() {
  const d=mealDraft;
  picker=null;dialog.classList.add('meal-dialog');
  dialog.innerHTML=`<div class="dialog-head"><h2>${d.strategyDay!==undefined?'Edit strategy meal':d.expectedLogIds.length?'Edit what you ate':'What did you eat?'}</h2><button class="icon-btn" data-action="dialog-close" aria-label="Close dialog">×</button></div><p class="subtext">Your menu is ready below. Tick foods you ate, edit portions, and add anything off the menu.</p><form id="meal-log-form"><div class="form-grid" ${d.strategyDay!==undefined?'hidden':''}><label class="field">Date<input type="date" id="meal-log-date" value="${d.date}" max="${state.today}" ${d.strategyDay!==undefined?'disabled':''} required></label><label class="field">Meal<select id="meal-log-slot" ${d.strategyDay!==undefined?'disabled':''}>${slotNames.map(m=>`<option value="${m}" ${d.meal===m?'selected':''}>${m[0].toUpperCase()+m.slice(1)}</option>`).join('')}</select></label></div><p class="inline-note">${days[(new Date(`${d.date}T12:00:00Z`).getUTCDay()+6)%7]}’s menu · ${esc(state.collegeName)}. Changing date or meal reloads its saved portions.</p><div class="meal-editor-actions"><button type="button" class="btn small" data-action="meal-select-menu">Select menu dishes</button><button type="button" class="btn ghost small" data-action="meal-clear">Clear selection</button></div><div class="meal-editor-rows">${d.rows.length?d.rows.map((row,i)=>{const f=food(row.foodId);return `<div class="meal-editor-row" data-impact-row="${i}"><input type="checkbox" data-meal-check="${i}" ${row.selected?'checked':''} aria-label="Ate ${esc(f.name)}"><div class="meal-editor-food"><strong>${foodEmoji(f)} ${esc(f.name)}</strong><small>${esc(f.serving)} · ${row.origin}</small>${f.dairy?'<span class="pill">Dairy</span>':''}${foodNutritionDetails(f)}<div data-impact-badge="${i}"></div>${d.strategyDay!==undefined?`<label class="small-note"><input type="checkbox" data-meal-repeat="${i}" ${row.applyAll?'checked':''}> Apply to this food at ${esc(d.meal)} on all matching days</label>`:''}</div><label class="field portion-field">Portions<input type="number" data-meal-portions="${i}" min="${d.strategyDay!==undefined?0:wholePortions(f)?1:0.5}" step="${wholePortions(f)?1:0.5}" value="${row.portions}" required aria-label="Portions of ${esc(f.name)}"></label></div>`;}).join(''):'<div class="empty">No dishes on this meal’s menu yet. Add an off-menu food below.</div>'}</div><div class="meal-editor-actions"><button type="button" class="btn" data-action="meal-add">${icon('plus')} Add off-menu food</button><button type="button" class="btn" data-action="meal-add" data-filter="dairy"> Add dairy</button></div><div id="meal-summary" class="meal-summary" aria-live="polite"></div><div id="meal-live-score" class="meal-summary" aria-live="polite">Updating plan score…</div>${impactLegend('addition')}<p class="inline-note">${d.strategyDay!==undefined?'This edits the strategy draft. Save the strategy to keep your changes.':'Saving replaces this meal’s actual log and any assumptions. Save an empty meal to record that you skipped it.'}</p><div class="form-footer"><button type="button" class="btn" data-action="dialog-close">Cancel</button><button class="btn primary" id="meal-save" type="submit">Save meal</button></div></form>`;
  updateMealSummary();if(!dialog.open)dialog.showModal();
}
function updateMealSummary() {
  mealDraft.rows.forEach((row,i)=>{ const input=$(`[data-meal-portions="${i}"]`,dialog); if(input){input.disabled=mealDraft.strategyDay===undefined&&!row.selected;} const check=$(`[data-meal-check="${i}"]`,dialog);if(check)check.checked=row.selected; });
  const selected=mealDraft.rows.filter(r=>r.selected),values=total(selected);
  $('#meal-summary',dialog).textContent=`${selected.length} foods selected · ${fmt(values.calories)} kcal · ${fmt(values.protein,1)} g protein${selected.some(r=>['calories','protein','carbs','fat'].some(k=>food(r.foodId).nutrients[k]===null))?' · Known subtotal only; some foods have unknown nutrition.':''}`;
  $('#meal-save',dialog).textContent=`Save meal · ${selected.length} foods`;
  scheduleLiveImpacts();
}
function showPicker(mode, context = {}) {
  picker={mode,filter:'all',...context};
  dialog.classList.remove('meal-dialog');
  dialog.innerHTML=`<div class="dialog-head"><h2>${({menu:'Add to your menu',log:'What did you eat?',extra:'A little extra for the day',preference:'Choose a food preference','meal-add':'Add an off-menu food'})[mode]}</h2><button class="icon-btn" data-action="dialog-close" aria-label="Close dialog">×</button></div><p class="subtext">Search recipe estimates, dairy, or IFCT ingredients. Raw ingredients use 100 g portions.</p>${mode==='meal-add'?'<button class="btn ghost" data-action="meal-back">← Back to your meal</button>':''}<div class="picker-filters" role="group" aria-label="Food category">${[['all','All foods'],['dairy',' Dairy'],['recipes','Prepared dishes'],['ingredients','Ingredients']].map(([id,label])=>`<button class="btn small ${picker.filter===id?'primary':''}" data-action="picker-filter" data-filter="${id}" aria-pressed="${picker.filter===id}">${label}</button>`).join('')}</div><label class="visually-hidden" for="food-search">Search foods</label><input id="food-search" placeholder="Try poha, dahi, milk, paneer…" autocomplete="off"><div class="search-results" id="search-results"></div>`;
  if(!dialog.open)dialog.showModal(); searchFoods(''); $('#food-search').focus();
}
function searchFoods(query) {
  const q=query.trim().toLowerCase();
  const results=catalog.filter(f=>{
    const category=picker.filter==='dairy'?f.dairy:picker.filter==='recipes'?f.ingredients.length>0:picker.filter==='ingredients'?(f.id.startsWith('ifct-')||f.kind==='ingredient'):true;
    return category && (q ? `${f.name} ${f.aliases||''} ${f.group}`.toLowerCase().includes(q) : picker.filter==='ingredients'||(!f.id.startsWith('ifct-')&&f.kind!=='ingredient'));
  });
  $('#search-results',dialog).innerHTML=results.slice(0,45).map(f=>`<button class="search-result" data-action="food-pick" data-food="${esc(f.id)}"><span class="food-icon">${foodEmoji(f)}</span><span class="result-body"><strong>${esc(f.name)}</strong><small>${esc(f.serving)} · ${esc(f.source)}</small></span><span>${foodValue(f,'calories')} kcal</span></button>`).join('')+(results.length?'': '<div class="empty">No matching foods. Try a different name or category.</div>')+(results.length>45?'<p class="small-note">Showing the first 45 results. Narrow your search to find more.</p>':'');
}
function pickedFood(id) {
  const f=food(id); if(!f) return;
  if(picker.mode==='meal-add') {
    const existing=mealDraft.rows.find(r=>r.foodId===id);
    if(existing){existing.selected=true;existing.portions ||= 1;}else mealDraft.rows.push({foodId:id,portions:1,selected:true,origin:'Off menu'});
    renderMealEditor();return;
  }
  if(picker.mode==='menu') {
    const list=menuDraft.menu[picker.day][picker.meal];
    if(list.includes(id)&&!picker.replacing)return toast('That food is already on this meal’s menu.');
    const targets=menuApplyAll?menuDraft.menu.map((_,i)=>i):[picker.day];
    for(const day of targets){const items=menuDraft.menu[day][picker.meal];if(picker.replacing){if(items.includes(picker.replacing))menuDraft.menu[day][picker.meal]=[...new Set(items.map(value=>value===picker.replacing?id:value))];}else if(!items.includes(id))items.push(id);}
    dialog.close();render();return;
  }
  if(picker.mode==='preference') {
    if(!profileDraft.preferred.includes(id)&&!profileDraft.excluded.includes(id)) profileDraft.preferred.push(id);
    dialog.close(); render(); return;
  }
  picker.foodId=id;
  const extra=picker.mode==='extra';
  dialog.innerHTML=`<div class="dialog-head"><h2>${extra?'Add a day-only option':'Log your food'}</h2><button class="icon-btn" data-action="dialog-close" aria-label="Close dialog">×</button></div><div class="selected-food">${foodEmoji(f)} ${esc(f.name)}<small>${esc(f.serving)} · ${foodValue(f,'calories')} kcal · ${foodValue(f,'protein',1,1)} g protein</small><small>${esc(f.basis)}${f.ingredients.length?` Ingredients: ${f.ingredients.map(i=>`${esc(food(i.foodId).name)} ${i.grams!==null?`${i.grams} g`:`${i.amount===null?'':fmt(i.amount,2)} ${esc(i.unit||'source amount unspecified')}`}`).join('; ')}`:''}</small></div><form id="food-form" class="dialog-form"><label class="field">Date<input type="date" name="date" value="${extra?shift(weekStart,selectedDay):(journalDate||state.today)}" ${extra?'':`max="${state.today}"`} required></label><label class="field">Meal<select name="meal">${slotNames.map(s=>`<option value="${s}" ${extra&&s==='snacks'?'selected':''}>${s[0].toUpperCase()+s.slice(1)}</option>`).join('')}</select></label>${extra?'<p class="subtext">This food will be available to the planner for this date and meal only. Select that meal in your attendance to include it.</p>':`<label class="field">How many portions?<input type="number" name="portions" min="${wholePortions(f)?1:0.5}" step="${wholePortions(f)?1:0.5}" value="1" required><small>Use the listed serving. Bowl/katori foods allow half portions; other foods use whole portions.</small></label>`}<button class="btn primary" type="submit">${icon(extra?'plus':'check')}${extra?'Add day-only extra':'Save food log'}</button><button class="btn ghost" type="button" data-action="picker-back">Choose a different food</button></form>`;
}
function saveProfileDraft() {
  const form=$('#profile-form'); if(!form) return;
  const v=new FormData(form);
  for(const k of ['name','gender','activity']) profileDraft[k]=v.get(k);
  for(const k of ['age','height','weight']) profileDraft[k]=Number(v.get(k));
  profileDraft.calorieCap=v.get('calorieCap')===''?null:Number(v.get('calorieCap'));
  profileDraft.dairyFree=v.has('dairyFree');
}
function generate(){openPlanningConstraints();}
async function generatePlanNow() {
  if(busy) return;
  busy=true;
  const buttons=[...document.querySelectorAll('[data-action=generate]')];
  for(const b of buttons){b.disabled=true;b.textContent='Building your plan…';}
  const notice=$('#plan-generation-status');
  if(notice){notice.hidden=false;notice.textContent='Building your plan. This may take up to 30 seconds.';}
  try {
    // Refresh the server's week before generating, including tabs left open
    // across Monday midnight. Keep any explicitly selected future week.
    state=await api('state');
    if(!weekStart||weekStart<state.weekStart){
      debug.log(`Planner week advanced from ${weekStart} to ${state.weekStart}`);
      weekStart=state.weekStart;selectedDay=0;
    }
  }catch(error){toast(error.message,true);render();return;}
  finally{busy=false;}
  await mutate('plan','POST',{start:weekStart},'Your weekly plan is ready.');
  render();
}
async function handleAction(button) {
  const a=button.dataset.action;
  if(a==='startup-retry')return init();
  if(a==='constraint-menu'||a==='constraint-groups'){dialog.close();location.hash=a==='constraint-menu'?'menu':'nutrition';return;}
  if(a==='constraint-add'){
    const foodId=$('#constraint-food').value,meal=$('#constraint-meal').value;
    if(!menuConstraintFoods(meal).some(f=>f.id===foodId))return toast('Choose a food from the current menu.',true);
    if(!constraintRows.some(r=>r.foodId===foodId&&r.meal===meal))constraintRows.push({foodId,meal,min:0,max:5,days:state.menu.flatMap((day,i)=>(meal==='all'?slotNames.some(m=>day[m].includes(foodId)):day[meal].includes(foodId))?[i]:[])});
    renderConstraintRows();return;
  }
  if(a?.startsWith('auth-')){authMode=a.slice(5);renderAuth();return;}
  if(a==='logout'){stopInitialPlanWatch();await api('auth/logout','POST',{});state=null;menuDraft=profileDraft=strategyDraft=mealDraft=null;dialog.close();authMode='login';renderAuth();return;}
  if(a==='strategy-score'){
    button.disabled=true;
    try { const draft=strategyDraft, signature=JSON.stringify(draft), result=await api('strategies/score','POST',draft);if(strategyDraft===draft&&JSON.stringify(strategyDraft)===signature)$('#draft-strategy-score').innerHTML=strategyScoreDetails(result); }
    catch(error){toast(error.message,true);}finally{button.disabled=false;}return;
  }
  if(a==='strategy-new'){strategyDraft={name:'My meal strategy',notes:'',days:days.map(()=>({entries:[]}))};location.hash='strategies';render();return;}
  if(a==='strategy-suggested'){const plan=state.plan;if(!plan)return;strategyDraft={name:'My suggested strategy',notes:'Adapted from the NutriMess optimizer.',days:plan.days.map(d=>({entries:d.entries.map(({foodId,meal,portions})=>({foodId,meal,portions}))}))};location.hash='strategies';render();return;}
  if(a==='strategy-edit'){strategyDraft=structuredClone(state.strategies.find(s=>s.id===button.dataset.id));render();return;}
  if(a==='strategy-cancel'){strategyDraft=null;render();return;}
  if(a==='strategy-meal'){const i=Number(button.dataset.day), meal=button.dataset.meal;openMealEditor(shift(state.weekStart,i),meal);mealDraft.strategyDay=i;mealDraft.expectedLogIds=[];const entries=strategyDraft.days[i].entries.filter(e=>e.meal===meal);const menuIds=state.menu[i][meal],extraIds=state.extras.filter(e=>e.date===mealDraft.date&&e.meal===meal).map(e=>e.foodId);mealDraft.rows=[...new Set([...menuIds,...extraIds,...entries.map(e=>e.foodId)])].map(foodId=>{const portions=entries.filter(e=>e.foodId===foodId).reduce((sum,e)=>sum+e.portions,0);return {foodId,portions,selected:portions>0,origin:menuIds.includes(foodId)?'Mess menu':extraIds.includes(foodId)?'Day-only extra':'Strategy'};});renderMealEditor();return;}
  if(a==='strategy-activate')return mutate(`strategies/${button.dataset.id}/activate`,'POST',{},'Strategy activated. Missed meals follow this saved version from today.');
  if(a==='strategy-delete')return mutate(`strategies/${button.dataset.id}`,'DELETE',null,'Strategy removed. Historical assumptions are preserved.');
  if(a==='strategy-log'){dialog.innerHTML=`<form id="strategy-log-form" data-id="${esc(button.dataset.id)}"><h2>Log a strategy meal</h2><label class="field">Date<input name="date" type="date" value="${state.today}" max="${state.today}" required></label><label class="field">Meal<select name="meal">${slotNames.map(m=>`<option>${m}</option>`).join('')}</select></label><p class="subtext">Logs the selected date’s weekday meal. Existing actual logs are protected.</p><div class="form-footer"><button class="btn" type="button" data-action="dialog-close">Cancel</button><button class="btn primary">Log meal</button></div></form>`;dialog.showModal();return;}
  if(a==='analysis-select'){
    analysisFoodId=button.dataset.food;
    const detail=$('#analysis-detail');
    detail.innerHTML=foodAnalysisDetail(food(analysisFoodId),analysisMenuFoods());
    document.querySelectorAll('[data-action="analysis-select"]').forEach(el=>el.setAttribute('aria-pressed',String(el.dataset.food===analysisFoodId)));
    if(button.closest('#analysis-ranking'))detail.scrollIntoView?.({behavior:'smooth',block:'start'});
    return;
  }
  if(button.dataset.view){location.hash=button.dataset.view;return;}
  if(a==='dialog-close'){if(picker?.mode==='meal-add'&&mealDraft){picker=null;renderMealEditor();}else dialog.close();return;}
  if(a==='day'){selectedDay=Number(button.dataset.day);render();return;}
  if(a==='generate') return generate();
  if(a==='log-open') return openMealEditor(journalDate||state.today,'breakfast');
  if(a==='meal-edit') return openMealEditor(button.dataset.date,button.dataset.meal);
  if(a==='meal-add') return showPicker('meal-add',{filter:button.dataset.filter||'all'});
  if(a==='meal-back'){picker=null;renderMealEditor();return;}
  if(a==='meal-select-menu'){for(const row of mealDraft.rows)if(row.origin==='Mess menu'){row.selected=true;row.portions ||= 1;}renderMealEditor();return;}
  if(a==='meal-clear'){for(const row of mealDraft.rows){row.selected=false;if(mealDraft.strategyDay!==undefined)row.portions=0;}renderMealEditor();return;}
  if(a==='picker-filter') {
    picker.filter=button.dataset.filter;
    for(const b of dialog.querySelectorAll('[data-action="picker-filter"]')){b.classList.toggle('primary',b.dataset.filter===picker.filter);b.setAttribute('aria-pressed',String(b.dataset.filter===picker.filter));}
    searchFoods($('#food-search').value);return;
  }
  if(a==='extra-open') return showPicker('extra');
  if(a==='preference-open'){saveProfileDraft();return showPicker('preference');}
  if(a==='food-pick') return pickedFood(button.dataset.food);
  if(a==='picker-back'){const mode=picker.mode;dialog.close();return showPicker(mode);}
  if(a==='menu-add') return showPicker('menu',{day:Number(button.dataset.day),meal:button.dataset.meal});
  if(a==='menu-replace')return showPicker('menu',{day:Number(button.dataset.day),meal:button.dataset.meal,replacing:button.dataset.food});
  if(a==='menu-remove'){for(const day of menuApplyAll?menuDraft.menu.map((_,i)=>i):[Number(button.dataset.day)])menuDraft.menu[day][button.dataset.meal]=menuDraft.menu[day][button.dataset.meal].filter(id=>id!==button.dataset.food);render();return;}
  if(a==='menu-reset'){menuDraft=null;render();toast('Edits discarded.');return;}
  if(a==='menu-save'){const ok=await mutate('menu','PUT',menuDraft,'Menu saved. Build a fresh plan to use your changes.');if(ok){menuDraft=null;render();}return;}
  if(a==='college-save') {
    const name=menuDraft.collegeName;
    const result=await api('colleges','POST',{name,menu:menuDraft.menu});
    colleges=[...colleges.filter(c=>!result.some(r=>r.id===c.id)),...result];
    menuDraft.collegeId=result.at(-1).id;render();toast('College template saved. Save your menu to apply it.');return;
  }
  if(a==='extra-delete') return mutate(`extras/${button.dataset.id}`,'DELETE',null,'Extra removed. Regenerate your plan.');
  if(a==='log-delete') return mutate(`logs/${button.dataset.id}`,'DELETE',null,'Entry removed. Nutrition stats updated.');
  if(a==='log-planned') return openMealEditor(button.dataset.date,button.dataset.meal);
  if(a==='export') {
    const blob=new Blob([JSON.stringify({exportedAt:new Date().toISOString(),profile:state.profile,nutritionBaseline:state.nutritionBaseline,menu:state.menu,attendance:state.attendance,logs:state.logs,estimatedLogs:state.estimatedLogs,strategies:state.strategies,activations:state.activations,completedMeals:state.completedMeals,extras:state.extras,colleges:state.colleges},null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`nutrimess-${state.today}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);toast('Your data export is ready.');
  }
}
document.addEventListener('click',e=>{const button=e.target.closest('button');if(!button||button.type==='submit'&&button.form)return;handleAction(button).catch(err=>toast(err.message,true));});
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
dialog.addEventListener('input',e=>{
  if(e.target.id==='food-search')searchFoods(e.target.value);
  if(e.target.dataset.mealPortions!==undefined){mealDraft.rows[Number(e.target.dataset.mealPortions)].portions=Number(e.target.value);if(mealDraft.strategyDay!==undefined)mealDraft.rows[Number(e.target.dataset.mealPortions)].selected=Number(e.target.value)>0;updateMealSummary();}
});
document.addEventListener('input',e=>{
  if(e.target.id==='analysis-search'){
    analysisQuery=e.target.value;
    $('#analysis-food-list').innerHTML=foodAnalysisList(analysisMenuFoods());
  }
});
document.addEventListener('change',async e=>{
  if(e.target.id==='analysis-nutrient'||e.target.id==='analysis-scope'){
    analysisNutrient=$('#analysis-nutrient').value;analysisScope=$('#analysis-scope').value;
    $('#analysis-ranking').innerHTML=foodAnalysisRanking(analysisMenuFoods());return;
  }

  if(e.target.dataset.foodPlanningGroup){
    const rules=structuredClone(currentPlanningRules()), foodId=e.target.dataset.foodPlanningGroup;
    rules.overrides=rules.overrides.filter(row=>row.foodId!==foodId);rules.overrides.push({foodId,group:e.target.value});
    await mutate('planning-rules','PUT',rules,'Food group saved. Rebuild the suggested plan to apply it.');return;
  }
  if(e.target.matches('[data-strategy-nutrition-period],[data-strategy-nutrition-meal]')){
    const panel=e.target.closest('.strategy-nutrition'), key=panel.closest('[data-strategy-stats]').dataset.strategyStats;
    const strategy=key==='draft'?strategyDraft:key==='active'?state.activations.at(-1):state.strategies.find(s=>s.id===key);
    $('.strategy-nutrition-body',panel).innerHTML=strategyNutritionValues(strategy,$('[data-strategy-nutrition-period]',panel).value,$('[data-strategy-nutrition-meal]',panel).value);
    return;
  }
  const el=e.target;
  if(el.id==='constraint-meal'){updateConstraintFoodOptions();return;}
  if(el.id==='menu-apply-all'){menuApplyAll=el.checked;return;}
  if(el.dataset.mealRepeat!==undefined){mealDraft.rows[Number(el.dataset.mealRepeat)].applyAll=el.checked;scheduleLiveImpacts();return;}
  if(el.dataset.boundKeep!==undefined){const row=constraintRows[Number(el.dataset.boundKeep)];row.min=el.checked?Math.max(row.min,1):0;row.max=Math.max(row.max,row.min);renderConstraintRows();return;}
  if(el.dataset.boundMin!==undefined){const row=constraintRows[Number(el.dataset.boundMin)];row.min=Number(el.value);row.max=Math.max(row.max,row.min);renderConstraintRows();return;}
  if(el.dataset.boundMax!==undefined){constraintRows[Number(el.dataset.boundMax)].max=Number(el.value);return;}
  if(el.id==='meal-log-date'||el.id==='meal-log-slot'){
    const date=$('#meal-log-date').value,meal=$('#meal-log-slot').value;
    if(date&&date<=state.today)openMealEditor(date,meal);return;
  }
  if(el.dataset.mealCheck!==undefined){const row=mealDraft.rows[Number(el.dataset.mealCheck)];row.selected=el.checked;if(el.checked)row.portions ||= 1;else if(mealDraft.strategyDay!==undefined)row.portions=0;$(`[data-meal-portions="${el.dataset.mealCheck}"]`,dialog).value=row.portions;updateMealSummary();}
  if(el.dataset.mealPortions!==undefined){mealDraft.rows[Number(el.dataset.mealPortions)].portions=Number(el.value);if(mealDraft.strategyDay!==undefined)mealDraft.rows[Number(el.dataset.mealPortions)].selected=Number(el.value)>0;updateMealSummary();}
  if(el.closest('#strategy-form')){strategyDraft.name=$('#strategy-name').value;strategyDraft.notes=$('#strategy-notes').value;}
  if(el.closest('#profile-form'))saveProfileDraft();
  if(el.dataset.preference){const id=el.dataset.preference;profileDraft.preferred=profileDraft.preferred.filter(x=>x!==id);profileDraft.excluded=profileDraft.excluded.filter(x=>x!==id);if(el.value!=='neutral')profileDraft[el.value].push(id);render();}
  if(el.id==='week-start'){const d=new Date(`${el.value}T12:00:00Z`);if(!el.value||d.getUTCDay()!==1||el.value<state.weekStart){toast('Choose the current week or a later Monday.',true);el.value=weekStart;return;}weekStart=el.value;selectedDay=0;render();}
  if(el.id==='journal-date'){journalDate=el.value||state.today;render();}
  if(el.dataset.attendance!==undefined){menuDraft.attendance[Number(el.dataset.attendance)][el.dataset.meal]=el.checked;render();}
  if(el.id==='college-name')menuDraft.collegeName=el.value;
  if(el.id==='college-select'){
    const college=colleges.find(c=>c.id===el.value);
    if(college){menuDraft.menu=structuredClone(college.menu);menuDraft.collegeName=college.name;menuDraft.collegeId=college.id;}
    else {menuDraft.collegeId='custom';menuDraft.collegeName='My weekly menu';menuDraft.menu=Array.from({length:7},()=>Object.fromEntries(slotNames.map(s=>[s,[]])));}
    render();
  }
});
document.addEventListener('submit',async e=>{
  e.preventDefault();
  if(e.target.id==='planning-constraints-form'){
    const form=new FormData(e.target),rules=structuredClone(currentPlanningRules());
    rules.consistentPortions=false;rules.dailyMilk=form.has('dailyMilk');rules.dailyCurd=form.has('dailyCurd');rules.requireGroups=form.has('requireGroups');
    for(const name of Object.keys(rules.minimums))rules.minimums[name]=Number(form.get(`piece-${name}`));
    for(const g of ['A','B'])rules['groupMinimum'+g]=Number(form.get(`group-${g}`));
    rules.foodBounds=constraintRows.map(({foodId,meal,min,max})=>({foodId,meal,min,max}));
    if(rules.foodBounds.some(r=>r.min>r.max))return toast('Minimum cannot exceed maximum.',true);
    if(await mutate('planning-rules','PUT',rules)){
      const start=weekStart>=state.weekStart?weekStart:state.weekStart;
      const checked=await api('plan/check','POST',{start});
      if(checked.conflicts.length){openPlanningConstraints(checked.conflicts);return;}
      await generatePlanNow();
    }return;
  }
  if(e.target.id==='planning-rules-form'){
    const form=new FormData(e.target), rules=structuredClone(currentPlanningRules());
    for(const type of Object.keys(rules.minimums))rules.minimums[type]=Number(form.get(`minimum-${type}`));
    rules.requireGroups=form.has('requireGroups');
    for(const key of ['dailyMilk','dailyCurd','consistentPortions'])rules[key]=form.has(key);
    for(const group of ['A','B'])rules[`groupMinimum${group}`]=Number(form.get(`groupMinimum${group}`));
    return mutate('planning-rules','PUT',rules,'Planning rules saved. Rebuild your plan to use them.');
  }
  if(e.target.id==='auth-form')return submitAuth(e.target);
  if(e.target.id==='strategy-form'){strategyDraft.name=$('#strategy-name').value;strategyDraft.notes=$('#strategy-notes').value;const ok=await mutate(strategyDraft.id?`strategies/${strategyDraft.id}`:'strategies',strategyDraft.id?'PUT':'POST',strategyDraft,'Strategy saved. Activate it to use it for missed meals.');if(ok){strategyDraft=null;render();}return;}
  if(e.target.id==='strategy-log-form'){const f=new FormData(e.target);await mutate(`strategies/${e.target.dataset.id}/log`,'POST',{date:f.get('date'),meal:f.get('meal')},'Strategy meal logged.');return;}
  if(e.target.id==='profile-form'){saveProfileDraft();const ok=await mutate('profile','PUT',profileDraft,'Profile saved. Your nutrition targets are updated.');if(ok){profileDraft=null;render();}}
  if(e.target.id==='meal-log-form') {
    const entries=mealDraft.rows.filter(r=>r.selected).map(({foodId,portions})=>({foodId,portions}));
    if(mealDraft.strategyDay!==undefined){strategyDraft=applyMealRows(strategyDraft,mealDraft);dialog.close();mealDraft=null;render();return;}
    const ok=await mutate('logs/meal','PUT',{date:mealDraft.date,meal:mealDraft.meal,expectedLogIds:mealDraft.expectedLogIds,entries},'Meal saved. Your nutrition stats are updated.');
    if(ok)mealDraft=null;
  }
  if(e.target.id==='food-form'){
    const form=new FormData(e.target);await mutate(picker.mode==='extra'?'extras':'logs','POST',{foodId:picker.foodId,date:form.get('date'),meal:form.get('meal'),...(picker.mode==='log'?{portions:Number(form.get('portions'))}:{})},picker.mode==='extra'?'Extra added for that date. Regenerate your plan.':'Food logged. Your nutrition stats are updated.');
  }
});
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(state&&titles[next]){if(view==='profile')saveProfileDraft();view=next;render();window.scrollTo({top:0,behavior:'instant'});}});
async function init(){
  stopInitialPlanWatch();
  debug.log('Startup: loading account state');
  try {
    // Load account state before private catalog and menu data.
    try {state=await api('state');}
    catch(error){
      if(error.status!==401)throw error;
      debug.log('Startup: no session; loading sign-in options');
      authOptions=await api('auth/options');renderAuth();debug.ready('Sign-in screen ready');return;
    }
    if(state.scoringMode)debug.log(`${state.scoringMode.label} active${state.scoringMode.calorieVariance ? ` · calorie variance ${state.scoringMode.calorieVariance} · excess-only soft penalty` : ''}`);
    debug.log('Startup: loading food catalog');
    const data=await api('catalog');catalog=data.foods;report=data.report;colleges=data.colleges;foodMap=new Map(catalog.map(f=>[f.id,f]));
    debug.log(`Startup: catalog loaded · ${catalog.length} foods`);
    weekStart=state.plan?.start>=state.weekStart?state.plan.start:state.weekStart;journalDate=state.today;selectedDay=Math.max(0,Math.min(6,Math.round((new Date(`${state.today}T12:00:00Z`)-new Date(`${weekStart}T12:00:00Z`))/86400000)));
    if(titles[location.hash.slice(1)])view=location.hash.slice(1);render();watchInitialPlan();debug.ready(`App ready · ${view}`);
  }catch(e){debug.fail(`Startup failed: ${e.message}`);app.innerHTML=`<div class="loading"><h1>Couldn’t get your plate ready.</h1><p>${esc(e.message)}</p><button class="btn primary" data-action="startup-retry">Try again</button><p>Open this address with <code>?debug=1</code> for startup diagnostics.</p></div>`;toast(e.message,true);}
}
init();

// Local experimental controls: constraints, repeated edits and counterfactual scores.
let constraintRows=[],menuApplyAll=false,impactTimer,impactEpoch=0;
function impactBadge(item){
  if(!item)return '';
  const scoreText=(value,logScore)=>formatPlanScore({value,logScore,experimental:item.scale==='log-score'});
  const title=item.mode==='addition'
    ? `Next +${fmt(item.step,2)} portion(s): ${fmt(item.portions,2)} → ${fmt(item.nextPortions,2)}. Score ${scoreText(item.currentScore,item.currentLogScore)} → ${scoreText(item.nextScore,item.comparisonLogScore)}.`
    : `Contribution of all ${fmt(item.portions,2)} portions in this meal. Current plan: ${scoreText(item.currentScore,item.currentLogScore)}; without this food: ${scoreText(item.withoutFoodScore,item.comparisonLogScore)}.`;
  return `<span class="impact-badge impact-level-${item.band}" title="${esc(title+(item.scale==='log-score'?` Log-score change: ${fmt(item.delta,4)}. Negative means this food lowers the product score; removing it may violate portion rules.`:''))}">${item.delta>=0?'+':''}${fmt(item.delta,2)} ${item.scale==='log-score'?'log-score':'points'}</span>`;
}
function planImpact(day,meal,id){return impactBadge(state.plan?.foodImpacts?.find(x=>x.day===day&&x.meal===meal&&x.foodId===id));}
function impactLegend(mode='contribution'){
  const editing=mode==='addition';
  const gaussian=state.scoringMode?.id==='gaussian';
  if(gaussian)return `<div class="impact-legend"><strong>Food effect on Gaussian score</strong></div><p class="small-note">${editing?'Effect of adding the next portion.':'Effect of all portions of this food compared with removing it.'} Badges show changes in log-score so tiny products stay distinguishable. Negative means worse, positive means better. Removing a food may violate a minimum-portion rule.</p>`;
  return `<div class="impact-legend"><span>${editing?'Effect of the next portion added:':'Total food contribution:'}</span>${['Much worse','Worse','Slightly worse','Neutral','Better','Much better'].map((s,i)=>`<span class="impact-badge impact-level-${i}">${s}</span>`).join('')}</div><p class="small-note">${editing?'Points predict adding the next 0.5 bowl/katori portion or next whole portion to your current edit. They update after each change. Manual edits can exceed five portions; that cap applies only to optimizer search.':'Points = current plan score minus its score without all portions of this food in this meal. Other meals stay unchanged.'} Hover for comparison scores. Unknown nutrients remain unknown; rule exceptions are listed separately.</p>`;
}

function openPlanningConstraints(conflicts=[]){
  picker=null;
  const rules=currentPlanningRules(),occurrences=new Map();
  state.menu.forEach((day,i)=>slotNames.forEach(meal=>day[meal].forEach(foodId=>{
    const key=`${meal}:${foodId}`;if(!occurrences.has(key))occurrences.set(key,{foodId,meal,days:[]});occurrences.get(key).days.push(i);
  })));
  constraintRows=[...occurrences.values()].filter(row=>row.days.length>1||(rules.foodBounds||[]).some(b=>b.foodId===row.foodId&&(b.meal===row.meal||b.meal==='all'))).map(row=>{
    const bound=(rules.foodBounds||[]).find(b=>b.foodId===row.foodId&&b.meal===row.meal)||(rules.foodBounds||[]).find(b=>b.foodId===row.foodId&&b.meal==='all');
    return {...row,min:bound?.min||0,max:bound?.max??5};
  });
  for(const bound of rules.foodBounds||[])if(menuConstraintFoods(bound.meal).some(f=>f.id===bound.foodId)&&!constraintRows.some(r=>r.foodId===bound.foodId&&r.meal===bound.meal))constraintRows.push({...bound,days:[]});
  dialog.classList.add('meal-dialog');
  dialog.innerHTML=`<div class="dialog-head"><h2>Choose constraints before planning</h2><button class="icon-btn" data-action="dialog-close" aria-label="Close">×</button></div><p>These foods repeat at the same meal on multiple days. Choose whether to keep them whenever offered and set their minimum and maximum. Quantities can vary between days.</p><p class="inline-note"><strong>Search limit:</strong> the optimizer considers up to 5 portions per food in a meal. Manual edits can exceed this.</p>${conflicts.length?`<section class="warning" role="alert"><h3>Resolve these conflicts before planning</h3>${conflicts.map(c=>`<p><strong>${pretty(c.date,{weekday:'long',day:'numeric',month:'short'})} ${esc(c.meal||'')}</strong>: ${esc(c.reason)}</p>`).join('')}<div class="toolbar"><button type="button" class="btn" data-action="constraint-menu">Edit menu</button><button type="button" class="btn" data-action="constraint-groups">Review food groups</button></div></section>`:''}<form id="planning-constraints-form"><div class="form-grid"><label class="check-label field full"><span><input type="checkbox" name="dailyMilk" ${rules.dailyMilk?'checked':''}>Include milk every day, at least one listed glass</span></label><label class="check-label field full"><span><input type="checkbox" name="dailyCurd" ${rules.dailyCurd?'checked':''}>Include curd every day, at least one listed bowl</span></label></div><details><summary>Piece and group minimums</summary><div class="form-grid">${Object.entries(rules.minimums).map(([name,value])=>`<label class="field">Minimum ${name} pieces<input type="number" name="piece-${name}" min="0" max="5" step="1" value="${Math.min(5,value)}"></label>`).join('')}<label class="check-label field full"><span><input type="checkbox" name="requireGroups" ${rules.requireGroups?'checked':''}>Require a choice from each available A/B group</span></label>${['A','B'].map(g=>`<label class="field">Group ${g} choice minimum<input name="group-${g}" type="number" min="0" max="5" step="0.5" value="${Math.min(5,rules['groupMinimum'+g])}"></label>`).join('')}</div></details><h3>Foods repeated across days</h3><div id="constraint-rows" class="constraint-rows"></div><h3>Set a limit for a food in your menu</h3><p class="small-note">Only foods offered in your current weekly menu are listed. Choose a meal to narrow the list.</p><div class="toolbar"><select id="constraint-food" aria-label="Food for individual limit">${menuConstraintFoods('all').map(f=>`<option value="${esc(f.id)}">${esc(f.name)} · ${esc(f.serving)}</option>`).join('')}</select><select id="constraint-meal" aria-label="Meal for individual limit">${['all',...slotNames].map(m=>`<option value="${m}">${m==='all'?'All meals':m}</option>`).join('')}</select><button type="button" class="btn" data-action="constraint-add">Add item limit</button></div><div class="form-footer"><button type="button" class="btn" data-action="dialog-close">Cancel</button><button type="submit" class="btn primary">Save constraints & build plan</button></div></form>`;
  renderConstraintRows();if(!dialog.open)dialog.showModal();
}
function renderConstraintRows(){
  $('#constraint-rows').innerHTML=constraintRows.map((row,i)=>{const f=food(row.foodId),step=wholePortions(f)?1:.5;return `<div class="constraint-row"><div><strong>${esc(f.name)}</strong><small>${row.meal==='all'?'All meals':row.meal} · ${row.days.length?`${row.days.length}/7 days offered`:'individual limit'} · ${esc(f.serving)}</small><label><input type="checkbox" data-bound-keep="${i}" ${row.min>0?'checked':''}> Keep on every offered day</label></div><label>Min<input type="number" min="0" max="5" step="${step}" value="${row.min}" data-bound-min="${i}" required></label><label>Max<input type="number" min="0" max="5" step="${step}" value="${row.max}" data-bound-max="${i}" required></label></div>`;}).join('')||'<p>No repeated foods. Add individual limits below.</p>';
}
function applyMealRows(strategy,draft){
  const index=draft.strategyDay??(new Date(`${draft.date}T12:00:00Z`).getUTCDay()+6)%7,slot=draft.meal;
  const entries=draft.rows.filter(r=>r.selected&&r.portions>0).map(r=>({foodId:r.foodId,portions:r.portions,meal:slot}));
  strategy.days[index].entries=[...strategy.days[index].entries.filter(e=>e.meal!==slot),...entries];
  for(const row of draft.rows.filter(r=>r.applyAll))strategy.days.forEach((day,i)=>{
    if(i===index||(!state.menu[i][slot].includes(row.foodId)&&!day.entries.some(e=>e.meal===slot&&e.foodId===row.foodId)))return;
    day.entries=day.entries.filter(e=>e.meal!==slot||e.foodId!==row.foodId);
    if(row.selected&&row.portions>0)day.entries.push({foodId:row.foodId,meal:slot,portions:row.portions});
  });
  return strategy;
}
function scheduleLiveImpacts(){
  clearTimeout(impactTimer);const epoch=++impactEpoch,draft=mealDraft;
  if(!draft||!$('#meal-live-score',dialog))return;
  impactTimer=setTimeout(async()=>{
    if(draft!==mealDraft||!dialog.open)return;
    if(draft.rows.some(r=>r.selected&&(!Number.isFinite(r.portions)||r.portions<=0||!Number.isInteger(r.portions/(wholePortions(food(r.foodId))?1:.5))))){$('#meal-live-score',dialog).textContent='Use positive whole/half portions for the listed serving type.';return;}
    const base=strategyDraft||state.plan||state.activations.at(-1)||{days:days.map(()=>({entries:[]}))};
    const strategy=applyMealRows(structuredClone(base),draft),day=draft.strategyDay??(new Date(`${draft.date}T12:00:00Z`).getUTCDay()+6)%7;
    try{
      const result=await api('strategies/impact','POST',{name:'Editing preview',days:strategy.days,day,meal:draft.meal,candidates:draft.rows.slice(0,150).map(r=>r.foodId)});
      if(epoch!==impactEpoch||draft!==mealDraft||!$('#meal-live-score',dialog))return;
      $('#meal-live-score',dialog).innerHTML=`<strong>Plan score: ${formatPlanScore(result.score)} / 100</strong>${result.score.overrides.length?`<details><summary>${result.score.overrides.length} rule exceptions</summary>${result.score.overrides.map(o=>`<p>${days[o.day]} ${o.meal}: ${esc(o.message)}</p>`).join('')}</details>`:''}`;
      draft.rows.forEach((row,i)=>{const item=result.impacts.find(x=>x.foodId===row.foodId),el=$(`[data-impact-row="${i}"]`,dialog),badge=$(`[data-impact-badge="${i}"]`,dialog);if(el)el.className=`meal-editor-row${item?.band!==null&&item?.band!==undefined?' impact-level-'+item.band:''}`;if(badge)badge.innerHTML=impactBadge(item);});
      const scorePanel=$('#draft-strategy-score');if(scorePanel)scorePanel.innerHTML=strategyScoreDetails(result.score);
    }catch(error){if(epoch===impactEpoch&&$('#meal-live-score',dialog))$('#meal-live-score',dialog).textContent=error.message;}
  },180);
}

function planImpactClass(day,meal,id){const x=state.plan?.foodImpacts?.find(x=>x.day===day&&x.meal===meal&&x.foodId===id);return x?.band!==null&&x?.band!==undefined?`impact-level-${x.band}`:'';}

function menuConstraintFoods(meal='all'){
  const ids=new Set(state.menu.flatMap(day=>meal==='all'?slotNames.flatMap(m=>day[m]):day[meal]));
  return [...ids].map(food).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name));
}
function updateConstraintFoodOptions(){
  const select=$('#constraint-food'),previous=select.value,items=menuConstraintFoods($('#constraint-meal').value);
  select.innerHTML=items.map(f=>`<option value="${esc(f.id)}">${esc(f.name)} · ${esc(f.serving)}</option>`).join('');
  if(items.some(f=>f.id===previous))select.value=previous;
  select.disabled=!items.length;
  $('[data-action="constraint-add"]').disabled=!items.length;
}


// Nutrient density comparisons use one reference serving and unique weekly menu foods.
let analysisFoodId=null, analysisQuery='', analysisNutrient='protein', analysisScope='menu';
function nutrientDensity(f,key) {
  const calories=f?.nutrients?.calories, value=f?.nutrients?.[key];
  if(!Number.isFinite(calories)||calories<=0||!Number.isFinite(value)||value<0)return null;
  return value/calories;
}
function densityRank(f,key,items) {
  const value=nutrientDensity(f,key);
  const known=items.map(item=>nutrientDensity(item,key)).filter(v=>v!==null);
  if(value===null||!known.length)return null;
  // Competition ranking: equal densities share a rank. Unknown values are excluded.
  const rank=1+known.filter(v=>v>value&&!densityEqual(v,value)).length;
  return {value,rank,count:known.length,score:value===0?0:known.length===1?100:100*(known.length-rank)/(known.length-1)};
}
function densityEqual(a,b){return Math.abs(a-b)<=1e-10*Math.max(Math.abs(a),Math.abs(b),Number.MIN_VALUE);}
function analysisMenuFoods(){
  return [...new Set((menuDraft||state).menu.flatMap(day=>slotNames.flatMap(meal=>day[meal]||[])))].map(food).filter(Boolean).sort((a,b)=>a.name.localeCompare(b.name));
}
function analysisFoodButton(f,menuIds){
  return `<button type="button" class="search-result" data-action="analysis-select" data-food="${esc(f.id)}" aria-pressed="${f.id===analysisFoodId}"><span class="result-body"><strong>${esc(f.name)}</strong><small>${esc(f.serving)} · ${menuIds.has(f.id)?'On your menu':'Outside menu'}</small></span></button>`;
}
function foodAnalysisList(items){
  const ids=new Set(items.map(f=>f.id)), query=analysisQuery.trim().toLowerCase();
  const matches=f=>query.split(/\s+/).every(word=>`${f.name} ${f.aliases||''} ${f.group||''}`.toLowerCase().includes(word));
  const menuItems=query?items.filter(matches):items;
  const outside=query?catalog.filter(f=>!ids.has(f.id)&&matches(f)).sort((a,b)=>a.name.localeCompare(b.name)):[];
  return `<h3>Current menu · ${menuItems.length}</h3>${menuItems.map(f=>analysisFoodButton(f,ids)).join('')||'<p class="notice">No menu foods found.</p>'}${query?`<h3 class="mt">Outside your menu · ${outside.length}</h3>${outside.map(f=>analysisFoodButton(f,ids)).join('')||'<p class="notice">No other foods match this search.</p>'}`:''}`;
}
function foodAnalysisPage(){
  const items=analysisMenuFoods();
  if(!food(analysisFoodId))analysisFoodId=items[0]?.id||null;
  return `${heading('Food analysis','Compare nutrients per calorie across your weekly menu.', '<button class="btn" data-view="nutrition">Nutrition per serving</button>')}
  ${menuDraft?'<p class="notice">Includes your current menu edits. Save them in Mess menu to keep them.</p>':''}
  <div class="analysis-layout"><section class="card analysis-browser"><h2>Explore foods</h2><label class="field mt" for="analysis-search">Search menu and full catalog<input id="analysis-search" type="search" value="${esc(analysisQuery)}" placeholder="Try paneer, guava, or sambar…" autocomplete="off"></label><div id="analysis-food-list" class="analysis-food-list">${foodAnalysisList(items)}</div></section>
  <section class="card" id="analysis-detail" aria-live="polite">${foodAnalysisDetail(food(analysisFoodId),items)}</section></div>
  <section class="card mt"><h2>Highest nutrients per calorie</h2><p class="subtext">Choose any nutrient to see all ranked foods. Click a food to inspect it above.</p><div class="toolbar mt"><label class="field">Nutrient<select id="analysis-nutrient">${Object.entries(state.nutrients).filter(([k])=>k!=='calories').map(([k,n])=>`<option value="${k}" ${analysisNutrient===k?'selected':''}>${esc(n.name)}</option>`).join('')}</select></label><label class="field">Compare foods in<select id="analysis-scope"><option value="menu" ${analysisScope==='menu'?'selected':''}>Current menu</option><option value="catalog" ${analysisScope==='catalog'?'selected':''}>Full catalog</option></select></label></div><div id="analysis-ranking">${foodAnalysisRanking(items)}</div></section>`;
}
function foodAnalysisDetail(f,items){
  if(!f)return '<h2>Select a food</h2><p class="notice">Your menu is empty. Search the full catalog to explore a food.</p>';
  const outside=!items.some(item=>item.id===f.id), comparison=outside?[...items,f]:items;
  const rows=Object.entries(state.nutrients).filter(([key])=>key!=='calories').map(([key,n])=>({key,...n,...densityRank(f,key,comparison)}));
  const ranked=rows.filter(row=>row.rank), positive=ranked.filter(row=>row.value>0).sort((a,b)=>a.rank/a.count-b.rank/b.count);
  const strongest=positive.slice(0,3), weakest=[...positive].reverse().slice(0,3).filter(row=>!strongest.includes(row));
  const describe=rows=>rows.map(row=>`${esc(row.name)} (#${row.rank}/${row.count})`).join(', ');
  return `<div class="card-head"><h2>${esc(f.name)}</h2><span class="pill">${outside?'Outside menu':'On your menu'}</span></div><p class="subtext">${esc(f.serving)} · <strong>${Number.isFinite(f.nutrients.calories)?`${fmt(f.nutrients.calories,2)} kcal`:'Calories unknown'}</strong> per listed serving</p>
  <p class="inline-note">${outside?'Ranks show where this food would place when added to your current menu for comparison.':'Ranks compare unique foods across your current weekly menu.'} Each nutrient is divided by calories; #1 has the highest amount per calorie. Ties share a rank. Unknown values and foods without positive calories are excluded for that nutrient.</p>
  ${ranked.length?foodAnalysisRadar(rows):'<p class="notice">Not enough nutrition data to calculate nutrient-per-calorie ranks.</p>'}
  <div class="analysis-summary"><h3>Nutrient analysis</h3><p>${strongest.length?`Strongest relative ranks: ${describe(strongest)}.`:'No positive nutrient densities are available.'}${weakest.length?` Lower relative ranks: ${describe(weakest)}.`:''}</p><p class="inline-note">${rows.filter(row=>row.value===0).length} nutrients have recorded zero values; ${rows.length-ranked.length} cannot be ranked. Higher density means more of that nutrient per calorie, including fat and carbohydrates; it does not measure overall food quality or daily target coverage.</p></div>
  <details class="mt"><summary>All nutrient densities and ranks</summary><div class="table-wrap"><table class="food-table"><thead><tr><th>Nutrient</th><th>Amount per 100 kcal</th><th>Rank</th></tr></thead><tbody>${rows.map(row=>`<tr><td>${esc(row.name)}${f.partialNutrients?.includes(row.key)?' · partial data':''}</td><td>${row.rank?`${fmt(row.value*100,3)} ${esc(row.unit)}`:'Unknown'}</td><td>${row.rank?`#${row.rank} / ${row.count}`:'Unranked'}</td></tr>`).join('')}</tbody></table></div></details>${foodNutritionDetails(f)}`;
}
function foodAnalysisRadar(rows){
  const center=270,radius=164,angle=i=>2*Math.PI*i/rows.length-Math.PI/2;
  const point=(i,r)=>[center+Math.cos(angle(i))*r,center+Math.sin(angle(i))*r];
  const points=r=>rows.map((_,i)=>point(i,r).join(',')).join(' ');
  const labels={carbs:'Carbs',b1:'B1',b2:'B2',b6:'B6',b12:'B12',folate:'Folate'};
  return `<figure class="analysis-chart"><svg viewBox="0 0 540 540" role="img" aria-label="Nutrient density rank radar for ${esc(food(analysisFoodId)?.name)}. Rank one is outermost. Exact ranks are listed below."><title>Nutrient per calorie ranks</title>${[.25,.5,.75,1].map(scale=>`<polygon class="radar-grid" points="${points(radius*scale)}"/>`).join('')}${rows.map((_,i)=>{const [x,y]=point(i,radius);return `<line class="radar-grid" x1="${center}" y1="${center}" x2="${x}" y2="${y}"/>`;}).join('')}
  <polygon class="radar-area" points="${rows.map((row,i)=>point(i,radius*(row.score||0)/100).join(',')).join(' ')}"/>
  ${rows.map((row,i)=>{const [x,y]=point(i,radius*(row.score||0)/100),[lx,ly]=point(i,radius+43);return `${row.rank?`<circle cx="${x}" cy="${y}" r="3" class="radar-point"><title>${esc(row.name)}: #${row.rank} of ${row.count}, ${fmt(row.value*100,3)} ${esc(row.unit)} per 100 kcal</title></circle>`:''}<text x="${lx}" y="${ly}" text-anchor="middle" class="radar-label"><tspan x="${lx}">${esc(labels[row.key]||row.name)}</tspan><tspan x="${lx}" dy="14">${row.rank?`#${row.rank}/${row.count}`:'Unknown'}</tspan></text>`;}).join('')}</svg><figcaption class="inline-note">Outer edge = #1; center = last rank or recorded zero. Unknown axes have no point. Positions scale ranks within each nutrient’s available foods.</figcaption></figure>`;
}
function foodAnalysisRanking(items){
  const key=analysisNutrient,n=state.nutrients[key],pool=analysisScope==='catalog'?catalog:items;
  const known=pool.map(f=>({f,value:nutrientDensity(f,key)})).filter(row=>row.value!==null).sort((a,b)=>b.value-a.value||a.f.name.localeCompare(b.f.name));
  let rank=0,previous=null;
  return `<p class="inline-note">${known.length} foods ranked · ${pool.length-known.length} excluded for missing values or nonpositive calories. Amounts shown per 100 kcal; sorting is identical to amount per calorie. Ties share a rank.</p><div class="analysis-ranking-scroll table-wrap"><table class="food-table"><thead><tr><th>Rank</th><th>Food</th><th>${esc(n.name)} / 100 kcal</th><th>kcal / serving</th></tr></thead><tbody>${known.map(({f,value},i)=>{if(previous===null||!densityEqual(previous,value))rank=i+1;previous=value;return `<tr><td>#${rank}</td><td><button class="btn ghost small" type="button" data-action="analysis-select" data-food="${esc(f.id)}" aria-pressed="${f.id===analysisFoodId}">${esc(f.name)}</button>${f.partialNutrients?.includes(key)?'<small> · partial data</small>':''}</td><td>${fmt(value*100,3)} ${esc(n.unit)}</td><td>${fmt(f.nutrients.calories,2)}</td></tr>`;}).join('')}</tbody></table></div>${known.length?'':'<p class="notice">No foods with known nutrient values and positive calories in this selection.</p>'}`;
}
