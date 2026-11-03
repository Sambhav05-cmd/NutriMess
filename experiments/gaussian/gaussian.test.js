import test from 'node:test';
import assert from 'node:assert/strict';
import { gaussianPenalty, variances } from './parameters.js';
import { scoreStrategy, generatePlan } from './planner.js';
import { nutrients, targets } from '../../server/nutrition.js';
import { newStudent } from '../../server/accounts.js';

const close = (a, b) => assert.ok(Math.abs(a-b) < 1e-10, `${a} != ${b}`);
test('normalized Gaussian calibration, saturation, sensitivity and validation', () => {
  close(Math.exp(-gaussianPenalty(1.2, 2.4, 'b12')), Math.exp(-3.125));
  close(gaussianPenalty(1.2, 2.4, 'b12'), gaussianPenalty(1200, 2400, 'b12'));
  assert.ok(gaussianPenalty(.5, 1, 'b12') > gaussianPenalty(.5, 1, 'vitaminC'));
  for (const key of Object.keys(nutrients)) {
    assert.ok(variances[key] > 0);
    assert.equal(gaussianPenalty(1, 1, key), 0);
    assert.equal(gaussianPenalty(key === 'calories' ? 0 : 2, 1, key), 0);
    assert.ok(gaussianPenalty(key === 'calories' ? 2 : .5, 1, key) > 0);
  }
  for (const [actual, target] of [[NaN, 1], [-1, 1], [1, 0], [1, Infinity]])
    assert.throws(() => gaussianPenalty(actual, target, 'protein'));
});

test('calorie excess is strict while calories at or below the cap stay neutral', () => {
  for (const ratio of [0, .5, .99, 1]) assert.equal(gaussianPenalty(ratio, 1, 'calories'), 0);
  close(Math.exp(-gaussianPenalty(1.05, 1, 'calories')), Math.exp(-12.5));
  close(Math.exp(-gaussianPenalty(1.10, 1, 'calories')), Math.exp(-50));
  close(gaussianPenalty(1.10, 1, 'calories') / (.1 ** 2 / (2 * .09)), 900);
});

test('plan score equals the product; daily macros, weekly micros, cap and missing data', () => {
  const state = newStudent(), target = targets(state.profile);
  const food = { id: 'balanced', name: 'Balanced', serving: '1 bowl', ingredients: [], nutrients: { ...target } };
  const foods = new Map([[food.id, food]]);
  const plan = { days: Array.from({length: 7}, () => ({entries: [{foodId: food.id, portions: 1, meal: 'breakfast'}]})) };
  const score = () => scoreStrategy(plan, foods, target, state.profile);
  assert.equal(score().value, 100);
  food.nutrients.calories = 0;
  assert.equal(score().value, 100);
  food.nutrients.b12 = target.b12 * .5;
  food.nutrients.protein = target.protein * .8;
  close(score().logScore, -gaussianPenalty(.5, 1, 'b12') - 7 * gaussianPenalty(.8, 1, 'protein'));
  close(score().value, 100 * Math.exp(score().logScore));
  state.profile.calorieCap = target.calories / 2;
  food.nutrients.calories = target.calories;
  const before = structuredClone(plan);
  close(score().logScore, -gaussianPenalty(.5, 1, 'b12') - 7 * gaussianPenalty(.8, 1, 'protein') - 7 * gaussianPenalty(2, 1, 'calories'));
  assert.deepEqual(plan, before);
  food.nutrients.b12 = null;
  assert.ok(score().incomplete.includes('b12'));
  food.nutrients.b12 = target.b12;
  food.partialNutrients = ['b12'];
  assert.ok(score().incomplete.includes('b12'));
});

test('Gaussian search chooses the brute-force best tiny feasible plan', () => {
  const state = newStudent(), target = targets(state.profile);
  Object.assign(state.profile.planningRules, { dailyMilk: false, dailyCurd: false, consistentPortions: false, groupMinimums: false });
  const food = { id: 'balanced', name: 'Balanced', serving: '1 piece', ingredients: [], nutrients: { ...target } };
  const foods = new Map([[food.id, food]]);
  state.menu = Array.from({length: 7}, () => ({breakfast: [food.id], lunch: [], dinner: [], snacks: []}));
  state.attendance = Array.from({length: 7}, () => ({breakfast: true, lunch: false, dinner: false, snacks: false}));
  const original = structuredClone(state);
  const plan = generatePlan(state, foods, target, '2026-11-02');
  assert.equal(scoreStrategy(plan, foods, target, state.profile).logScore, 0);
  assert.ok(plan.days.every(day => day.entries.length === 1 && day.entries[0].portions === 1));
  assert.deepEqual(state, original);
});

test('exact weekly search matches independent full enumeration', async () => {
  const {generateExhaustivePlan} = await import('./planner.js');
  const state = newStudent(), target = targets(state.profile);
  Object.assign(state.profile.planningRules, {requireGroups:false,dailyMilk:false,dailyCurd:false});
  const foods = new Map(['a','b'].map((id,i) => [id, {id,name:id,serving:'1 piece',ingredients:[],
    nutrients:Object.fromEntries(Object.entries(target).map(([key,value]) => [key,value*(i ? .25 : .45)]))}]));
  state.profile.planningRules.foodBounds = ['a','b'].map(foodId => ({foodId,meal:'all',min:0,max:2}));
  state.menu = Array.from({length:7},(_,i) => ({breakfast:i<2?['a','b']:[],lunch:[],dinner:[],snacks:[]}));
  state.attendance = Array.from({length:7},(_,i) => ({breakfast:i<2,lunch:false,dinner:false,snacks:false}));
  let expected = -Infinity;
  for(let a=0;a<=2;a++)for(let b=0;b<=2;b++)for(let c=0;c<=2;c++)for(let d=0;d<=2;d++) {
    const strategy={days:Array.from({length:7},(_,i)=>({entries:i<2?
      [{foodId:'a',portions:i===0?a:c,meal:'breakfast'},{foodId:'b',portions:i===0?b:d,meal:'breakfast'}].filter(e=>e.portions):[]}))};
    expected=Math.max(expected,scoreStrategy(strategy,foods,target,state.profile).logScore);
  }
  const exact=generateExhaustivePlan(state,foods,target,'2026-11-02');
  assert.equal(exact.search.rawCombinations,'81');
  assert.equal(exact.search.complete,true);
  assert.equal(exact.search.optimal,true);
  close(scoreStrategy(exact,foods,target,state.profile).logScore,expected);
  const limited=generateExhaustivePlan(state,foods,target,'2026-11-02',{maxNodes:1});
  assert.equal(limited.search.complete,false);
  assert.equal(limited.search.optimal,false);
});

test('NITK search can remove calorie-heavy portions instead of accepting a bad beam plan', async () => {
  const {foods,messMenuPreset} = await import('../../server/catalog.js');
  const state=newStudent(), target=targets(state.profile);
  state.menu=structuredClone(messMenuPreset.menu);
  const plan=generatePlan(state,foods,target,'2026-11-02');
  // This menu/profile has feasible plans below the target; this is a regression
  // for the former ~18.85% excess, not a hard-cap rule for arbitrary menus.
  assert.ok(plan.days.every(day=>day.total.calories<=target.calories+1e-8));
  assert.ok(scoreStrategy(plan,foods,target,state.profile).logScore > -12);
  const {upperLimits}=await import('../../server/nutrition.js');
  for(const day of plan.days)for(const [key,limit]of Object.entries(upperLimits))assert.ok(day.total[key]<=limit+.001);
});

test('Gaussian food impacts retain direction even when both displayed products underflow', async () => {
  const {execFileSync}=await import('node:child_process');
  execFileSync(process.execPath,['--import','./experiments/gaussian/enable.js','--input-type=module','-e',`
    import assert from 'node:assert/strict';
    import {foodImpacts} from './server/food-impact.js';
    import {newStudent} from './server/accounts.js';
    import {targets} from './server/nutrition.js';
    const state=newStudent(), target=targets(state.profile);
    const food={id:'food',name:'Food',ingredients:[],serving:'1 piece',nutrients:{...target}};
    const foods=new Map([[food.id,food]]);
    const plan={days:Array.from({length:7},()=>({entries:[{foodId:'food',meal:'breakfast',portions:5}]}))};
    const {score,impacts:[impact]}=foodImpacts(plan,foods,target,state.profile,state,[{day:0,meal:'breakfast',foodId:'food'}]);
    assert.equal(score.value,0);
    assert.equal(impact.currentScore,0);
    assert.equal(impact.comparisonScore,0);
    assert.equal(impact.scale,'log-score');
    assert.ok(impact.delta<0);
    assert.equal(impact.delta,impact.objectiveDelta);
  `],{cwd:new URL('../../',import.meta.url),stdio:'pipe'});
});
