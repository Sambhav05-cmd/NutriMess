import test from 'node:test';
import assert from 'node:assert/strict';
import { loadINDB, supplementINDB } from '../server/indb.js';
import { catalog, foods, dataReport } from '../server/catalog.js';
import { nutrients, targets } from '../server/nutrition.js';
import { generatePlan, isAllowed } from '../server/planner.js';

const primary=catalog.filter(f=>!f.id.startsWith('indb-'));

test('INDB supplements missing entries without changing primary foods or adding common duplicates',()=>{
  assert.ok(dataReport.indb.addedRecipes>250);
  assert.ok(dataReport.indb.addedIngredients>100);
  assert.equal(new Set(catalog.map(f=>f.id)).size,catalog.length);
  for(const [sourceCode,id] of [['ASC096','chapati'],['ASC144','idli'],['BFP148','dosa'],['BFP045','poha'],['ASC215','palak'],['BFP316','raita']]) {
    assert.equal(foods.has(`indb-${sourceCode}`),false);
    assert.equal(dataReport.indb.primaryMatches.find(r=>r.sourceCode===sourceCode).foodId,id);
  }
  assert.equal(foods.has('indb-ingredient-L520'),false,'Existing USDA curd remains authoritative');
  assert.equal(foods.has('indb-ingredient-T508'),false,'Sunflower oil uses the primary IFCT entry');
  assert.equal(foods.get('curd').nutrients.calories,91.5);
  const snapshot=loadINDB(),copy=structuredClone(primary);
  const added=supplementINDB(copy,snapshot,[]);
  assert.deepEqual(copy,primary,'Supplementing must not mutate primary records');
  assert.ok(added.foods.length>0);
});

test('INDB serving units, unknown nutrients and original ingredient references survive normalization',()=>{
  const source=loadINDB(),sambar=foods.get('indb-ASC167');
  const row=source.recipes.find(r=>r.food_code==='ASC167');
  assert.equal(sambar.nutrients.calories,Number(row.unit_serving_energy_kcal));
  assert.equal(sambar.nutrients.protein,Number(row.unit_serving_protein_g));
  assert.match(sambar.serving,/1 bowl/);
  assert.equal(sambar.nutrients.b12,null);
  assert.equal(sambar.nutrients.vitaminA,null);
  assert.equal(sambar.nutrients.vitaminE,null);
  const fallback=catalog.find(f=>f.kind==='recipe'&&f.grams===100);
  assert.ok(fallback);assert.match(fallback.serving,/100 g/);
  assert.equal(fallback.nutrients.calories,Number(source.recipes.find(r=>r.food_code===fallback.sourceCode).energy_kcal));
  for(const f of catalog.filter(f=>f.id.startsWith('indb-'))) {
    for(const k of Object.keys(nutrients))assert.ok(f.nutrients[k]===null||Number.isFinite(f.nutrients[k])&&f.nutrients[k]>=0,`${f.id} ${k}`);
    for(const i of f.ingredients)assert.ok(foods.has(i.foodId),`${f.id}: unresolved ingredient ${i.foodId}`);
  }
  const masala=foods.get('indb-ingredient-G523');
  assert.equal(masala.nutrients.fiber,null,'Source N must never become zero');
  const tea=foods.get('indb-ingredient-V510');
  assert.ok(tea.traceFields.includes('calories'));assert.equal(tea.nutrients.calories,0);
});

test('INDB filters hidden animal ingredients and excessive source estimates; dairy and exclusions reach new recipes',()=>{
  assert.equal(foods.has('indb-ASC367'),false,'Poha cutlet contains an egg');
  assert.equal(foods.has('indb-ASC206'),false,'Extreme kofta estimate is not imported');
  assert.ok(dataReport.indb.skipped.some(r=>r.code==='ASC367'));
  const profile={name:'Test',age:21,sex:'male',height:172,weight:65,activity:'moderate',calorieCap:null,excluded:[],preferred:[],dairyFree:false};
  const milkshake=foods.get('indb-ASC016');
  assert.equal(milkshake.dairy,true);
  assert.equal(isAllowed(milkshake,{...profile,dairyFree:true}),false);
  const sambar=foods.get('indb-ASC167');
  assert.equal(isAllowed(sambar,{...profile,excluded:[sambar.ingredients[0].foodId]}),false);
  const plan=generatePlan({profile,logs:[],extras:[],menu:Array.from({length:7},()=>({breakfast:[],lunch:['indb-ASC167'],dinner:[],snacks:[]})),attendance:Array.from({length:7},()=>({breakfast:false,lunch:true,dinner:false,snacks:false}))},foods,targets(profile),'2026-11-02');
  assert.ok(plan.days.every(d=>d.entries.some(e=>e.foodId==='indb-ASC167')));
  assert.ok(plan.unknown.includes('b12'));
});

test('INDB rejects misleading vegetarian dish names when ingredients include a non-vegetarian IFCT code',()=>{
  const snapshot={source:'test',sourceUrl:'https://example.com',ingredients:[],recipes:[{food_code:'X001',food_name:'Vegetable surprise'}],recipeIngredients:[{recipe_code:'X001',food_code:'M001',food_name:'Egg, poultry, whole, raw'}]};
  const result=supplementINDB(primary,snapshot,[{code:'M001',tags:'eggetarian nonveg'}]);
  assert.equal(result.foods.length,0);assert.equal(result.report.skipped.length,1);
});
