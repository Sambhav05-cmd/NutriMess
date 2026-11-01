import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

test('custom, active and draft strategies show weekly, daily and meal nutrition with missing-data labels', async () => {
  const days = Array.from({ length: 7 }, () => ({ entries: [] }));
  days[0].entries = [{ foodId: 'milk', meal: 'breakfast', portions: 2 }, { foodId: 'curd', meal: 'lunch', portions: .5 }];
  days[1].entries = [{ foodId: 'milk', meal: 'breakfast', portions: 1 }];
  const strategy = { id: 'custom-plan', name: 'My own plan', notes: '', revision: 1, updatedAt: '2026-11-01', days };
  const score={value:73.2,incomplete:['b12'],overrides:[{day:0,meal:'breakfast',message:'Choose a group B side.'}]};
  const state = { profile: { name: 'Student' }, today: '2026-11-01', weekStart: '2026-10-26', logs: [], estimatedLogs: [], extras: [],
    menu: Array.from({ length: 7 }, () => ({ breakfast: ['milk'], lunch: ['curd'], dinner: [], snacks: [] })),
    nutrients: { calories: { name: 'Calories', unit: 'kcal' }, protein: { name: 'Protein', unit: 'g' }, carbs:{name:'Carbohydrates',unit:'g'},fat:{name:'Fat',unit:'g'}, b12: { name: 'Vitamin B12', unit: 'µg' }, vitaminK: { name: 'Vitamin K', unit: 'µg' } },
    targets: { calories: 2000, protein: 60, carbs:200, fat:60, b12: 2.4, vitaminK: 120 },
    nutritionBaseline:{date:'2026-11-01',coverage:1},
    intakeHistory:{b12:{mode:'turnover',assumedStart:true,historyCoverage:1,startingCoverage:1,retainedTargetDays:0,retentionPerDay:.999,halfLifeDays:693}},
    turnoverEvidence:{nutrients:{b12:{summary:'Reference turnover.'}}},
    strategyScores:{'custom-plan':score},activeStrategyScore:score,
    strategies: [strategy], activations: [{ ...structuredClone(strategy), name: 'Older active version' }] };
  state.activations[0].days[0].entries[0].portions = 1;
  const foods = [{ id: 'milk', name: 'Milk', nutrients: { calories: 100, protein: 5, b12: 1, vitaminK: 2 }, partialNutrients: ['vitaminK'], serving: '1 glass' },
    { id: 'curd', name: 'Curd', nutrients: { calories: 80, protein: 4, b12: null, vitaminK: null }, serving: '1 bowl', nutritionModel: {} }];
  const errors = [], vc = new VirtualConsole();
  vc.on('jsdomError', error => errors.push(error));
  const dom = new JSDOM(await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8'), { url: 'http://localhost/#strategies', runScripts: 'outside-only', virtualConsole: vc });
  const w = dom.window, q = selector => w.document.querySelector(selector);
  w.fetch = async (path, options={}) => {
    if(path==='/api/planning-rules'){state.planningRules=JSON.parse(options.body);return new Response(JSON.stringify(state));}
    return new Response(JSON.stringify(path === '/api/state' ? state : path==='/api/strategies/score'?score:{ foods, colleges: [], report: {} }));
  };
  w.structuredClone = structuredClone;
  w.scrollTo = () => {};
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', ''); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); };
  const change = (root, selector, value) => { const el = root.querySelector(selector); el.value = value; el.dispatchEvent(new w.Event('change', { bubbles: true })); };
  const row = (root, key) => root.querySelector(`[data-nutrient="${key}"]`);
  try {
    w.eval(await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8'));
    const deadline = Date.now() + 2000;
    while (!q('[data-strategy-stats="custom-plan"]')) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
    const saved = q('[data-strategy-stats="custom-plan"]');
    assert.match(saved.textContent,/Strategy score: 73.2 \/ 100/);
    assert.match(saved.querySelector('.strategy-nutrition summary').textContent, /View nutrition stats/);
    assert.equal(row(saved, 'calories').children[1].textContent, '340 kcal');
    assert.equal(row(saved, 'calories').children[2].textContent, '14,000 kcal');
    assert.equal(row(saved, 'protein').children[1].textContent, '17 g');
    assert.match(row(saved, 'b12').textContent, /incomplete data.*3 µg.*coverage unverified/);
    assert.match(row(saved, 'vitaminK').textContent, /incomplete data/);
    assert.equal(row(q('[data-strategy-stats="active"]'), 'calories').children[1].textContent, '240 kcal');
    change(saved, '[data-strategy-nutrition-period]', '0');
    assert.equal(row(saved, 'calories').children[1].textContent, '240 kcal');
    assert.equal(row(saved, 'calories').children[2].textContent, '2,000 kcal');
    change(saved, '[data-strategy-nutrition-meal]', 'breakfast');
    assert.equal(row(saved, 'b12').children[1].textContent, '2 µg');
    assert.doesNotMatch(row(saved, 'b12').textContent, /incomplete|unverified/);
    change(saved, '[data-strategy-nutrition-meal]', 'lunch');
    assert.match(row(saved, 'b12').textContent, /Unknown.*No values available/);
    assert.match(row(saved, 'calories').textContent, /modeled estimate/);
    q('[data-action="strategy-edit"]').click();
    const draft = q('[data-strategy-stats="draft"]');
    assert.equal(row(draft, 'calories').children[1].textContent, '340 kcal');
    q('[data-action="strategy-score"]').click();
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.match(q('#draft-strategy-score').textContent,/Strategy score: 73.2 \/ 100/);
    q('[data-action="strategy-meal"][data-day="0"][data-meal="breakfast"]').click();
    change(q('#dialog'), '[data-meal-portions="0"]', '3');
    q('#meal-log-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
    assert.equal(row(q('[data-strategy-stats="draft"]'), 'calories').children[1].textContent, '440 kcal');
    assert.equal(row(q('[data-strategy-stats="custom-plan"]'), 'calories').children[1].textContent, '340 kcal');
    q('[data-action="strategy-cancel"]').click();
    q('[data-action="strategy-new"]').click();
    assert.match(q('[data-strategy-stats="draft"]').textContent, /No foods selected/);
    assert.equal(row(q('[data-strategy-stats="draft"]'), 'calories').children[1].textContent, '0 kcal');
    w.location.hash='planner';await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(q('[name="minimum-roti"]').value,'2');
    change(q('#planning-rules-form'),'[name="minimum-roti"]','4');
    q('[name="requireGroups"]').checked=false;
    q('#planning-rules-form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(q('[name="minimum-roti"]').value,'4');
    assert.equal(state.planningRules.requireGroups,false);
    w.location.hash='nutrition';await new Promise(resolve=>setTimeout(resolve,20));
    change(q('#main'),'[data-food-planning-group="milk"]','A');
    await new Promise(resolve=>setTimeout(resolve,20));
    assert.equal(q('[data-food-planning-group="milk"]').value,'A');
    assert.deepEqual(state.planningRules.overrides,[{foodId:'milk',group:'A'}]);
    w.location.hash='journal';await new Promise(resolve=>setTimeout(resolve,20));
    assert.match(q('.history-item strong').textContent,/100%/);
    assert.match(q('#main').textContent,/assumed 100% history baseline/);
    assert.deepEqual(errors, []);
  } finally { w.close(); }
});
