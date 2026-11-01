import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { parse } from 'csv-parse/sync';
import { foods, catalog, catalogVersion, dataReport, messMenuPreset } from '../server/catalog.js';
import { messMenuSource, messFoodSource } from '../server/mess-menu.js';
import { dateKey, targets, totals } from '../server/nutrition.js';
import { refreshPlanNutrition } from '../server/planner.js';
import { importIFCT } from '../scripts/import-data.js';

test('NITK import preserves every weekday, meal, reference value and unknown', () => {
  const rows=parse(fs.readFileSync(messMenuSource),{bom:true,columns:true});
  const days=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'];
  for(const [index,day] of days.entries())for(const meal of ['breakfast','lunch','dinner','snacks']){
    assert.deepEqual(messMenuPreset.menu[index][meal].map(id=>foods.get(id).name),rows.filter(r=>r.day===day&&r.meal.toLowerCase()===meal).map(r=>r.menu_item));
  }
  assert.equal(dataReport.messMenu.rows,254);
  assert.equal(dataReport.messMenu.dishes,96);
  assert.equal(dataReport.messMenu.withNutrition,96);
  assert.equal(dataReport.messMenu.withoutNutrition,0);
  const rice=foods.get('nitk-white-rice');
  assert.equal(rice.nutrients.calories,180.6);
  assert.equal(rice.grams,140);
  assert.equal(rice.nutrients.b12,0,'plant-only model zero is retained as an estimate');
  const foodRows=parse(fs.readFileSync(messFoodSource),{bom:true,columns:true});
  const sambar=foods.get('nitk-sambar'),row=foodRows.find(r=>r.menu_item==='Sambar');
  assert.equal(sambar.nutrients.protein,Number(row.protein_g));
  assert.equal(sambar.additionalNutrients.sodium.value,Number(row.sodium_mg));
  assert.equal(foods.get('nitk-tea').nutrients.calories,48.3);
  const idli=foods.get('nitk-idli-3');
  assert.equal(idli.menuCount,3);
  assert.equal(idli.nutrients.calories,82.5,'one serving is one idli despite three pieces in the menu name');
  assert.equal(idli.grams,60);
  assert.match(idli.serving,/1 idli/);
  assert.equal(totals([{foodId:idli.id,portions:3}],foods).calories,247.5);
  assert.equal(foods.get('nitk-curd').dairy,true);
  assert.equal(foods.get('curd').nutrients.calories,91.5,'existing food references stay unchanged');
});

test('vitamin source, shared catalog and snapshot have consistent unique IDs and values',()=>{
  const rows=parse(fs.readFileSync(messFoodSource),{bom:true,columns:true});
  const fields={calories:'energy_kcal',protein:'protein_g',carbs:'carbohydrate_g',fat:'fat_g',fiber:'fiber_g',vitaminA:'vitamin_a_ug_rae',vitaminE:'vitamin_e_mg',vitaminK:'vitamin_k1_ug',b6:'vitamin_b6_mg',folate:'vitamin_b9_folate_ug',vitaminC:'vitamin_c_mg',vitaminD:'vitamin_d_ug',b12:'vitamin_b12_ug',calcium:'calcium_mg',magnesium:'magnesium_mg',iron:'iron_mg',zinc:'zinc_mg',potassium:'potassium_mg',b1:'vitamin_b1_mg',b2:'vitamin_b2_mg'};
  for(const row of rows){
    const food=catalog.find(f=>f.id.startsWith('nitk-')&&f.name===row.menu_item);
    assert.ok(food);
    for(const [key,column] of Object.entries(fields)){
      const source=food.nutrientSources[key];
      const expected=source.type==='dataset'?foods.get(source.foodId).nutrients[key]*source.scaleToServing:row[column]===''?null:Number(row[column]);
      assert.equal(food.nutrients[key],expected,`${food.id} ${key}`);
    }
    assert.equal(food.grams,Number(row.edible_weight_g_per_unit));
    assert.equal(food.portion.unit,row.serving_unit);
    assert.equal(food.portion.explanation,row.portion_explanation);
    assert.equal(food.nutritionModel.fortification,row.fortification_and_recipe_caution);
    assert.equal(food.confidence,row.nutrient_evidence);
    for(const [key,column] of Object.entries({sodium:'sodium_mg',phosphorus:'phosphorus_mg',b3:'vitamin_b3_mg',b5:'vitamin_b5_mg',freeSugar:'free_sugar_g'})){
      const reference=food.primaryReference&&foods.get(food.primaryReference.foodId);
      const primaryValue=reference?.additionalNutrients?.[key]?.value;
      const expected=Number.isFinite(primaryValue)?primaryValue*food.grams/reference.grams:Number(row[column]);
      assert.ok(Math.abs(food.additionalNutrients[key].value-expected)<1e-9,`${food.id} ${key}`);
    }
  }
  assert.equal(new Set(catalog.map(f=>f.id)).size,catalog.length);
  const snapshot=JSON.parse(fs.readFileSync(new URL('../.data/catalog.json',import.meta.url)));
  assert.equal(snapshot.version,catalogVersion);
  assert.deepEqual(snapshot.foods.find(f=>f.id==='nitk-curd'),foods.get('nitk-curd'));
  assert.equal(foods.get('nitk-curd').nutrients.vitaminA,40.5,'saved USDA reference takes priority at the new 150 g weight');
  assert.equal(foods.get('nitk-aloo-paratha-2').nutrients.vitaminA,0,'use explicit modeled RAE, not unconverted INDB A');
  assert.equal(foods.get('nitk-vada-2').nutrients.calories,79.8);
  assert.equal(foods.get('nitk-vada-2').nutrients.fat,2.91);
  assert.equal(foods.get('nitk-samosa').nutrients.calories,248);
  assert.equal(foods.get('nitk-gulab-jamun').nutrients.calories,186.6);
  assert.equal(foods.get('nitk-veg-cutlet').nutrients.calories,225);
  assert.equal(foods.get('nitk-paneer').nutrients.b12,1.31);
  assert.ok(Object.values(dataReport.messMenu.knownByNutrient).every(n=>n===96));
  assert.match(foods.get('nitk-oats').serving,/dry/);
  assert.equal(foods.get('nitk-tea').dairy,true,'ingredient proxy includes milk');
  importIFCT();
  const afterIFCT=JSON.parse(fs.readFileSync(new URL('../.data/catalog.json',import.meta.url)));
  assert.equal(afterIFCT.version,catalogVersion,'IFCT parsing must not overwrite the shared catalog');
  assert.ok(afterIFCT.foods.some(f=>f.id==='nitk-curd'));
});

test('stale saved plan totals refresh from food IDs without changing choices',()=>{
  const target=targets({gender:'male',weight:65,height:172,age:21,activity:'moderate'});
  const plan={start:'2026-11-02',createdAt:'original',method:'original method',calorieCap:2500,days:Array.from({length:7},()=>({entries:[{foodId:'nitk-curd',meal:'breakfast',portions:1.5}],total:{calories:0}})),weekly:{calories:0}};
  const refreshed=refreshPlanNutrition(plan,foods,target);
  assert.deepEqual(refreshed.days.map(d=>d.entries),plan.days.map(d=>d.entries));
  assert.equal(refreshed.days[0].total.vitaminA,60.75);
  assert.equal(refreshed.weekly.vitaminA,425.25);
  assert.ok(!refreshed.noData.includes('b12'));assert.ok(!refreshed.noData.includes('vitaminD'));
  assert.ok(!refreshed.estimated.includes('vitaminD'));assert.ok(!refreshed.estimated.includes('b12'),'dataset values must not be labeled uploaded estimates');
  assert.ok(!refreshed.unknown.includes('vitaminK'),'dataset K replaces fallback K1');
  assert.equal(refreshed.createdAt,'original');
});

test('NITK is selectable at signup, generates valid plans and uses shared values for logging',async()=>{
  process.env.DB_PATH=':memory:';
  const {app}=await import('../server/index.js');
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/`;let cookie='';
  async function request(route,body){
    const res=await fetch(base+route,{method:body?'POST':'GET',headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    return {status:res.status,data:await res.json()};
  }
  try{
    const options=await request('auth/options');
    assert.deepEqual(options.data.colleges.find(c=>c.id==='nitk-uploaded').menu,messMenuPreset.menu);
    const registered=await request('auth/register',{email:'nitk@example.com',password:'p',name:'NITK student',gender:'male',collegeId:'nitk-uploaded'});
    assert.equal(registered.status,200);
    assert.equal(registered.data.plan.catalogVersion,catalogVersion);
    assert.deepEqual(registered.data.menu,messMenuPreset.menu);
    for(const day of registered.data.plan.days)for(const entry of day.entries)assert.equal(foods.get(entry.foodId).planningEligible,true);
    const logged=await request('logs',{date:dateKey(),meal:'snacks',foodId:'nitk-tea',portions:1});
    assert.equal(logged.status,200);assert.ok(!logged.data.todayUnknown.includes('vitaminD'));
    const todayEntries=[...logged.data.logs,...logged.data.estimatedLogs].filter(e=>e.date===dateKey());
    assert.deepEqual(logged.data.todayTotals,totals(todayEntries,foods));
    const apiCatalog=await request('catalog');
    assert.deepEqual(apiCatalog.data.foods.find(f=>f.id==='nitk-tea'),foods.get('nitk-tea'));
    const source=await fetch(base+'mess-menu/source',{headers:{cookie}});
    assert.equal(source.status,200);assert.ok(Buffer.from(await source.arrayBuffer()).equals(fs.readFileSync(messMenuSource)));
    const vitaminSource=await fetch(base+'mess-menu/foods-source',{headers:{cookie}});
    assert.equal(vitaminSource.status,200);assert.ok(Buffer.from(await vitaminSource.arrayBuffer()).equals(fs.readFileSync(messFoodSource)));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
