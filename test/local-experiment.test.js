import test from 'node:test';
import assert from 'node:assert/strict';
import {generatePlan,portionOptionsFor} from '../server/planner.js';
import {foodImpacts} from '../server/food-impact.js';
import {newStudent} from '../server/accounts.js';
import {zero,targets} from '../server/nutrition.js';

test('local bounds cap choices at five without a B/A ratio requirement',()=>{
 const s=newStudent();s.profile.planningRules.dailyMilk=false;s.profile.planningRules.dailyCurd=false;
 s.profile.planningRules.foodBounds=[{foodId:'rice',meal:'lunch',min:4,max:4},{foodId:'dal',meal:'lunch',min:0,max:1}];
 const items=[{id:'rice',name:'Rice',planningGroup:'A',serving:'1 plate',ingredients:[],nutrients:{...zero(),calories:100,protein:4,carbs:20,fat:2}},{id:'dal',name:'Dal',planningGroup:'B',serving:'1 bowl',ingredients:[],nutrients:{...zero(),calories:100,protein:4,carbs:20,fat:2}}];
 const foods=new Map(items.map(f=>[f.id,f]));s.menu=Array.from({length:7},()=>({breakfast:[],lunch:['rice','dal'],dinner:[],snacks:[]}));
 assert.equal(portionOptionsFor(items[1]).at(-1),5);
 const plan=generatePlan(s,foods,targets(s.profile),'2026-11-02');
 for(const day of plan.days){assert.equal(day.entries.find(e=>e.foodId==='rice').portions,4);assert.equal(day.entries.find(e=>e.foodId==='dal').portions,1);assert.ok(day.entries.every(e=>e.portions<=5));}
 const result=foodImpacts(plan,foods,targets(s.profile),s.profile,s,[{day:0,meal:'lunch',foodId:'dal'}]);
 assert.equal(typeof result.score.value,'number');assert.ok(result.impacts[0].band===null||(result.impacts[0].band>=0&&result.impacts[0].band<=5));
});

test('preflight and search allow A-only meals after removing the ratio',async()=>{
 const {planningConflicts}=await import('../server/planner.js');
 const s=newStudent();s.profile.planningRules.dailyMilk=false;s.profile.planningRules.dailyCurd=false;
 const f={id:'dosa',name:'Dosa',planningGroup:'A',serving:'1 dosa',ingredients:[],nutrients:{...zero(),calories:100,protein:4,carbs:20,fat:2}};
 s.menu=Array.from({length:7},()=>({breakfast:['dosa'],lunch:[],dinner:[],snacks:[]}));
 const conflicts=planningConflicts(s,new Map([[f.id,f]]),'2026-11-02');
 assert.deepEqual(conflicts,[]);
 const plan=generatePlan(s,new Map([[f.id,f]]),targets(s.profile),'2026-11-02');assert.ok(plan.days.every(day=>day.entries.some(e=>e.foodId==='dosa')));
});

test('food impact removes every current portion from only the selected meal',async()=>{
 const {scoreStrategy}=await import('../server/planner.js');const {micros}=await import('../server/nutrition.js');
 const s=newStudent();s.profile.planningRules.dailyMilk=false;s.profile.planningRules.dailyCurd=false;
 const f={id:'food',name:'Food',planningGroup:'C',serving:'1 bowl',ingredients:[],nutrients:{...zero(),calories:100,protein:4,carbs:20,fat:2}},foods=new Map([[f.id,f]]);
 const days=Array.from({length:7},()=>({entries:[]}));days[0].entries=[{foodId:'food',meal:'lunch',portions:5},{foodId:'food',meal:'dinner',portions:1}];days[1].entries=[{foodId:'food',meal:'lunch',portions:2}];
 const original=structuredClone(days),target=targets(s.profile),result=foodImpacts({days},foods,target,s.profile,s,[{day:0,meal:'lunch',foodId:'food'},{day:2,meal:'lunch',foodId:'food'}]);
 const without=structuredClone(days);without[0].entries=without[0].entries.filter(e=>e.meal!=='lunch');
 const expected=scoreStrategy({days:without},foods,target,s.profile,s),raw=objective=>100/(1+Math.max(0,-objective)/(49+1.5*micros.length));
 assert.equal(result.impacts[0].portions,5);assert.equal(result.impacts[0].withoutFoodScore,raw(expected.objectiveScore));assert.equal(result.impacts[0].delta,result.impacts[0].currentScore-result.impacts[0].withoutFoodScore);assert.equal(result.impacts[1].delta,0);assert.deepEqual(days,original);
});

test('only calorie excess reduces the score; all other nutrient scores saturate at target',async()=>{
 const {scoreStrategy}=await import('../server/planner.js');const {nutrients}=await import('../server/nutrition.js');
 const s=newStudent();s.profile.planningRules.dailyMilk=false;s.profile.planningRules.dailyCurd=false;const target=targets(s.profile);
 const food={id:'balanced',name:'Balanced',planningGroup:'C',serving:'1 bowl',ingredients:[],nutrients:{...target}},foods=new Map([[food.id,food]]);
 const strategy={days:Array.from({length:7},()=>({entries:[{foodId:food.id,meal:'lunch',portions:1}]}))};
 const score=()=>scoreStrategy(strategy,foods,target,s.profile,s);
 assert.equal(score().value,100);
 for(const key of Object.keys(nutrients)){
  food.nutrients={...target,[key]:target[key]*2};
  if(key==='calories')assert.ok(score().value<100);else assert.equal(score().value,100,key);
  food.nutrients={...target,[key]:target[key]*.8};if(key==='calories')assert.equal(score().value,100);else assert.ok(score().value<100,`${key} shortfall`);
 }
});

test('search and displayed score agree when protein exceeds its target',async()=>{
 const {scoreStrategy}=await import('../server/planner.js');const s=newStudent();s.profile.planningRules.dailyMilk=false;s.profile.planningRules.dailyCurd=false;const target=targets(s.profile);
 const f={id:'high-protein',name:'High protein',planningGroup:'C',serving:'1 bowl',ingredients:[],nutrients:{...target,protein:target.protein*2}},foods=new Map([[f.id,f]]);
 s.menu=Array.from({length:7},()=>({breakfast:[],lunch:[f.id],dinner:[],snacks:[]}));
 const p=generatePlan(s,foods,target,'2026-11-02');assert.equal(scoreStrategy(p,foods,target,s.profile,s).value,100);assert.ok(p.days.every(d=>d.entries[0].portions===1));
});


test('calories are neutral from zero to target and only excess creates a loss',async()=>{
 const {scoreStrategy}=await import('../server/planner.js');const s=newStudent();s.profile.planningRules.dailyMilk=false;s.profile.planningRules.dailyCurd=false;const target=targets(s.profile);
 const f={id:'balanced',name:'Balanced',planningGroup:'C',serving:'1 bowl',ingredients:[],nutrients:{...target}},foods=new Map([[f.id,f]]);
 const strategy={days:Array.from({length:7},()=>({entries:[{foodId:f.id,meal:'lunch',portions:1}]}))};
 for(const fraction of [0,.25,.5,.99,1]){f.nutrients={...target,calories:target.calories*fraction};assert.equal(scoreStrategy(strategy,foods,target,s.profile,s).value,100);}
 f.nutrients={...target,calories:target.calories*1.2};assert.ok(scoreStrategy(strategy,foods,target,s.profile,s).value<100);
});


test('plan points measure whole-food contribution while editor points predict the next addition',()=>{
 const s=newStudent();s.profile.planningRules.dailyMilk=false;s.profile.planningRules.dailyCurd=false;const target=targets(s.profile);
 const f={id:'meal',name:'Meal',planningGroup:'C',serving:'1 bowl',ingredients:[],nutrients:{...target}},foods=new Map([[f.id,f]]);
 const days=Array.from({length:7},()=>({entries:[{foodId:f.id,meal:'lunch',portions:1}]}));
 const request=[{day:0,meal:'lunch',foodId:f.id}];
 const plan=foodImpacts({days},foods,target,s.profile,s,request).impacts[0];
 const edit=foodImpacts({days},foods,target,s.profile,s,request,'addition').impacts[0];
 assert.ok(plan.delta>0);assert.equal(plan.delta,plan.currentScore-plan.withoutFoodScore);
 assert.ok(edit.delta<0);assert.equal(edit.delta,edit.nextScore-edit.currentScore);assert.equal(edit.nextPortions,1.5);
 days[0].entries[0].portions=6;
 const large=foodImpacts({days},foods,target,s.profile,s,request,'addition').impacts[0];
 assert.equal(large.nextPortions,6.5);assert.equal(typeof large.nextScore,'number');
 days[0].entries=[];
 const empty=foodImpacts({days},foods,target,s.profile,s,request,'addition').impacts[0];assert.equal(empty.nextPortions,.5);assert.ok(empty.delta>0);
});
