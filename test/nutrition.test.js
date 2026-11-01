import test from 'node:test';
import assert from 'node:assert/strict';
import { targets, zero, monday, shiftDate, upperLimits, migrateProfileGender } from '../server/nutrition.js';
import { intakeHistory, retentionFor, halfLifeFor, turnoverEvidence } from '../server/turnover.js';
import { foods, catalog, sampleMenu } from '../server/catalog.js';
import { generatePlan, isAllowed, targetPenalty, availabilityBounds } from '../server/planner.js';

const profile = { name:'Test', age:21, sex:'male', weight:65, height:172, activity:'moderate', calorieCap:null, preferred:[], excluded:[], dairyFree:false };
const state = () => ({ profile:{...profile}, menu:sampleMenu(), attendance:Array.from({length:7},()=>({breakfast:true,lunch:true,dinner:true,snacks:true})), extras:[], logs:[] });

test('target penalties grow exponentially with relative gaps and micronutrient excess earns nothing',()=>{
  assert.equal(targetPenalty(100,100),0);
  assert.ok(targetPenalty(20,100)>2*targetPenalty(60,100));
  assert.equal(targetPenalty(60,100),targetPenalty(6,10),'units must not change the score');
  assert.equal(targetPenalty(150,100,true),0);
  assert.ok(targetPenalty(150,100)>0);
});
test('planner preserves vitamin D choices and flags unavailable targets',()=>{
  const target=targets(profile),s=state();
  const common=Object.fromEntries(Object.entries(target).map(([k,v])=>[k,v/2]));
  const map=new Map([['balanced',{id:'balanced',ingredients:[],nutrients:common}],['no-d',{id:'no-d',ingredients:[],nutrients:{...common,vitaminD:0,vitaminA:target.vitaminA*10}}]]);
  s.profile.preferred=['no-d'];s.menu=Array.from({length:7},()=>({breakfast:['no-d','balanced'],lunch:[],dinner:[],snacks:[]}));
  const plan=generatePlan(s,map,target,'2026-11-02');
  assert.ok(plan.weekly.vitaminD>=target.vitaminD*7*.9);
  s.menu=Array.from({length:7},()=>({breakfast:['no-d'],lunch:[],dinner:[],snacks:[]}));
  const bounds=availabilityBounds(s,map,target,'2026-11-02');
  assert.equal(bounds.maximum.vitaminD,0);assert.ok(bounds.unreachable.includes('vitaminD'));
});

test('IFCT units, edible-ingredient basis, unknown B12 and recipe math',()=>{
  const amaranth=foods.get('ifct-A001');
  assert.ok(Math.abs(amaranth.nutrients.calories-1490/4.184)<.001);
  assert.equal(amaranth.nutrients.calcium,181);
  assert.equal(amaranth.nutrients.b12,null);
  const milk=foods.get('milk'), ingredient=foods.get('ifct-L002');
  assert.ok(Math.abs(milk.nutrients.protein-ingredient.nutrients.protein*2.5)<1e-10);
  assert.equal(milk.nutrients.b12,null);
  assert.ok(catalog.length>300);
});
test('targets depend on body metrics, activity and reference sex',()=>{
  const target=targets(profile);
  assert.ok(target.calories>2000 && target.calories<3000);
  assert.equal(target.protein,78);
  assert.ok(targets({...profile,activity:'active'}).calories>target.calories);
  assert.equal(targets({...profile,sex:'female'}).iron,18);
});
test('legacy profiles migrate to one gender field and targets use that field',()=>{
  assert.deepEqual(migrateProfileGender({gender:'Woman',sex:'male',height:160}),{gender:'female',height:160});
  assert.deepEqual(migrateProfileGender({gender:'Prefer not to say',sex:'female'}),{gender:'female'});
  assert.deepEqual(migrateProfileGender({sex:'male'}),{gender:'male'});
  assert.equal(targets({...profile,gender:'female'}).iron,18);
});
test('date arithmetic preserves Monday and crosses years',()=>{
  assert.equal(monday('2026-10-30'),'2026-10-26');
  assert.equal(monday('2026-11-01'),'2026-10-26');
  assert.equal(monday('2026-11-02'),'2026-11-02');
  assert.equal(shiftDate('2026-12-31',1),'2027-01-01');
});
test('sourced intake signals decay by nutrient and daily budgets reset without claiming body-energy loss',()=>{
  const f={id:'test',nutrients:{...zero(),vitaminC:90,b12:2.4,b1:1.2,calories:2519}};
  const map=new Map([['test',f]]),target=targets(profile),logs=[{date:'2026-10-26',foodId:'test',portions:1}];
  const first=intakeHistory(logs,map,target,'2026-10-26');
  const next=intakeHistory(logs,map,target,'2026-10-27');
  assert.equal(first.b12.retainedTargetDays,1);
  assert.ok(Math.abs(next.b12.retainedTargetDays-.999)<1e-12);
  assert.ok(next.b12.retainedTargetDays>next.vitaminC.retainedTargetDays);
  assert.ok(next.vitaminC.retainedTargetDays>next.b1.retainedTargetDays);
  assert.equal(first.vitaminC.retainedTargetDays,intakeHistory([{...logs[0],portions:5}],map,target,'2026-10-26').vitaminC.retainedTargetDays);
  assert.equal(intakeHistory([],map,target,'2026-10-26').vitaminC.retainedTargetDays,0);
  assert.equal(first.calories.todayCoverage,1);
  assert.equal(next.calories.retainedTargetDays,0);
  assert.equal(next.calories.retentionPerDay,null);
  assert.equal(next.b12.initialStores,'unknown');
  assert.ok(Math.abs(halfLifeFor('b12')-692.8005)<.001);
  const later=intakeHistory(logs,map,target,shiftDate('2026-10-26',693));
  assert.ok(Math.abs(later.b12.retainedTargetDays-.5)<.001);
  assert.equal(retentionFor('vitaminD'),null);
  assert.equal(turnoverEvidence.nutrients.vitaminD.observedHalfLifeDays,15);
  for(const key of Object.keys(target))assert.ok(turnoverEvidence.nutrients[key].sourceIds.every(id=>turnoverEvidence.sources[id]?.url.startsWith('https://')));
});
test('dairy includes verified yogurt B12 and preserves edible portion scaling in recipes',()=>{
  assert.equal(foods.get('curd').nutrients.calories,91.5);
  assert.ok(Math.abs(foods.get('curd').nutrients.b12-.555)<1e-12);
  assert.ok(Math.abs(foods.get('buttermilk').nutrients.b12-.2775)<1e-12);
  assert.equal(foods.get('lassi').nutrients.calories,foods.get('curd').nutrients.calories);
  for(const id of ['curd','cheddar','milk','plain-paneer','buffalo-milk','khoa','ghee','buttermilk','lassi','raita','ifct-L004']){
    assert.equal(foods.get(id).dairy,true,id);
    assert.equal(isAllowed(foods.get(id),{...profile,dairyFree:true}),false,id);
  }
  const history=intakeHistory([{foodId:'milk',portions:1,date:'2026-10-26'},{foodId:'curd',portions:1,date:'2026-10-26'}],foods,targets(profile),'2026-10-26');
  assert.equal(history.b12.unknownEntries,1);
  assert.equal(history.b12.knownEntries,1);
  assert.ok(history.b12.retainedTargetDays>0);
});
test('ingredient exclusions and dairy preference reach prepared recipes',()=>{
  assert.equal(isAllowed(foods.get('poha'),{...profile,excluded:['ifct-T005']}),false);
  assert.equal(isAllowed(foods.get('palak'),{...profile,dairyFree:true}),false);
  assert.equal(isAllowed(foods.get('rice'),{...profile,dairyFree:true}),true);
});
test('planner respects calories, daily upper limits, attendance and exclusions',()=>{
  const s=state();s.profile.calorieCap=1800;s.profile.excluded=['palak','ifct-L002'];
  s.attendance[0].breakfast=false;
  const plan=generatePlan(s,foods,targets(s.profile),'2026-11-02');
  for(const day of plan.days){
    assert.ok(day.total.calories<=1800.001);
    for(const [k,limit] of Object.entries(upperLimits)) assert.ok(day.total[k]<=limit+.001,k);
    for(const entry of day.entries){assert.ok(entry.portions<=2);assert.ok(isAllowed(foods.get(entry.foodId),s.profile));}
  }
  assert.ok(!plan.days[0].entries.some(e=>e.meal==='breakfast'));
  assert.ok(plan.days.some(d=>d.entries.length));
  assert.ok(plan.unknown.includes('b12'));
  assert.ok(plan.gaps.includes('b12'));
});
test('day-only extras do not leak into other days and logged meals are not duplicated',()=>{
  const s=state();s.menu=Array.from({length:7},()=>({breakfast:[],lunch:[],dinner:[],snacks:[]}));
  s.extras=[{date:'2026-11-02',meal:'snacks',foodId:'guava'}];
  s.logs=[{date:'2026-11-02',meal:'breakfast',foodId:'milk',portions:1}];
  const plan=generatePlan(s,foods,targets(profile),'2026-11-02');
  assert.ok(plan.days[0].entries.some(e=>e.foodId==='guava'));
  assert.ok(plan.days.slice(1).every(d=>d.entries.length===0));
  assert.ok(plan.days[0].total.calories>=foods.get('milk').nutrients.calories);
  assert.ok(!plan.days[0].entries.some(e=>e.meal==='breakfast'));
});
test('planner explores quarter servings and all dishes beyond the old menu limit',()=>{
  const target=targets(profile),s=state();
  const ids=Array.from({length:8},(_,i)=>`dish-${i}`);
  const map=new Map(ids.map((id,i)=>[id,{id,ingredients:[],nutrients:{...zero(),...(i===7?Object.fromEntries(Object.entries(target).map(([k,v])=>[k,v/1.75])):{calories:10000})}}]));
  s.menu=Array.from({length:7},()=>({breakfast:ids,lunch:[],dinner:[],snacks:[]}));
  const plan=generatePlan(s,map,target,'2026-11-02');
  for(const day of plan.days){
    assert.deepEqual(day.entries.map(e=>[e.foodId,e.portions]),[['dish-7',1.75]]);
    assert.ok(Math.abs(day.total.calories-target.calories)<.001);
  }
});
test('full sample menu distributes food across selected main meals',()=>{
  const s=state();
  const plan=generatePlan(s,foods,targets(profile),'2026-11-02');
  for(const day of plan.days){
    for(const meal of ['breakfast','lunch','dinner']) assert.ok(day.entries.some(e=>e.meal===meal),`${day.date} ${meal}`);
    assert.ok(day.total.calories>=targets(profile).calories*.85);
  }
});
test('infeasible menus report gaps; existing logs over cap are preserved',()=>{
  const s=state();s.profile.calorieCap=1000;s.logs=[{date:'2026-11-02',meal:'lunch',foodId:'rice',portions:10}];
  const plan=generatePlan(s,foods,targets(profile),'2026-11-02');
  assert.equal(plan.days[0].entries.length,0);
  assert.ok(plan.days[0].total.calories>1000);
  assert.ok(plan.days[0].warnings.some(w=>w.includes('Existing logs')));
  s.menu=Array.from({length:7},()=>({breakfast:[],lunch:[],dinner:[],snacks:[]}));s.logs=[];
  const empty=generatePlan(s,foods,targets(profile),'2026-11-02');
  assert.ok(empty.gaps.length>=10);
  assert.ok(empty.days.every(d=>d.total.calories===0));
});
