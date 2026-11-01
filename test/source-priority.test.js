import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDatasetPriority } from '../server/source-priority.js';

test('datasets take nutrient-level priority, preserve zero, normalize weight and fill only missing fields',()=>{
  const fallback={name:'Curd',nutrients:{calories:999,vitaminD:5,b12:.2},source:'Uploaded model',additionalNutrients:{},partialNutrients:[]};
  const reference={id:'curd',source:'USDA reference',grams:150,nutrients:{calories:90,vitaminD:0,b12:null}};
  const result=applyDatasetPriority(fallback,[reference]);
  assert.equal(result.nutrients.calories,60);assert.equal(result.nutrients.vitaminD,0);
  assert.equal(result.nutrients.b12,.2);assert.deepEqual(result.fallbackNutrients,['b12']);
  assert.equal(result.nutrientSources.calories.type,'dataset');
  assert.equal(result.nutrientSources.b12.type,'uploaded-estimate');
  assert.equal(fallback.nutrients.calories,999,'source records are not mutated');
});
test('primary nutrients and additional nutrients scale to the uploaded household serving',()=>{
  const fallback={name:'Curd',grams:150,nutrients:{calories:999,vitaminD:5},source:'Uploaded model',additionalNutrients:{sodium:{value:999}}};
  const reference={id:'curd',source:'USDA reference',grams:150,nutrients:{calories:91.5,vitaminD:0},additionalNutrients:{sodium:{value:69}}};
  const result=applyDatasetPriority(fallback,[reference]);
  assert.equal(result.nutrients.calories,91.5);
  assert.equal(result.nutrients.vitaminD,0);
  assert.equal(result.additionalNutrients.sodium.value,69);
  assert.equal(result.nutrientSources.calories.scaleToServing,1);
  assert.match(result.basis,/to 150 g/);
});
test('raw ingredients and Excel references cannot override cooked food as a direct dataset match',()=>{
  const rice={name:'White rice',nutrients:{calories:129},source:'Uploaded cooked-food estimate'};
  assert.equal(applyDatasetPriority(rice,[{id:'ifct-A015',source:'IFCT 2017',grams:100,nutrients:{calories:350}}]).nutrients.calories,129);
  const paneer={name:'Paneer',nutrients:{calories:200},source:'Uploaded estimate'};
  assert.equal(applyDatasetPriority(paneer,[{id:'ifct-L003',source:'INDB Excel',grams:100,nutrients:{calories:999}}]).nutrients.calories,200);
});
