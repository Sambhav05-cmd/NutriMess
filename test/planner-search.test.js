import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePlan, portionOptionsFor, scoreStrategy } from '../server/planner.js';
import { defaultPlanningRules, mealRuleIssues, dailyFoods } from '../server/planning-rules.js';
import { zero, targets, portionStep, totals, upperLimits } from '../server/nutrition.js';
import { foods as catalog, messMenuPreset } from '../server/catalog.js';
import { newStudent } from '../server/accounts.js';

const start = '2026-11-02';
const emptyDay = () => ({breakfast:[],lunch:[],dinner:[],snacks:[]});
const dish = (id, group, values = {}, serving = '1 bowl') => ({id,name:id,planningGroup:group,serving,ingredients:[],nutrients:{...zero(),calories:100,protein:5,carbs:10,fat:3,...values}});
function fixture(items, rules = {}) {
  const state = newStudent();
  state.profile.planningRules = {...defaultPlanningRules(),dailyMilk:false,dailyCurd:false,...rules};
  state.menu = Array.from({length:7},emptyDay);
  return {state,foods:new Map(items.map(f=>[f.id,f])),target:targets(state.profile)};
}

test('only bowls and katoris allow fractional portions, in half steps', () => {
  for (const serving of ['1 bowl','1 small katori']) {
    const food=dish('rice','C',{},serving);
    assert.equal(portionStep(food),.5);
    assert.deepEqual(portionOptionsFor(food),[0,.5,1,1.5,2]);
  }
  for (const serving of ['1 glass','1 plate','100 g','2 medium rotis',undefined]) {
    assert.deepEqual(portionOptionsFor({...dish('food','C'),serving}),[0,1,2]);
  }
});

test('early group and nutrient pruning preserves the exact optimum in small exhaustive searches', () => {
  for (let seed=0; seed<12; seed++) for (const consistentPortions of [false,true]) {
    const items=[dish('base','A',{calcium:400+seed*110}),dish('curry','B',{calcium:250+seed*90}),dish('favorite','C',{calcium:600+seed*70,zinc:10})];
    const {state,foods,target}=fixture(items,{consistentPortions,groupMinimumA:1,groupMinimumB:1.5});
    state.profile.preferred=['favorite'];
    state.menu[0].lunch=items.map(f=>f.id);
    let best=-Infinity;
    for (const a of portionOptionsFor(items[0],state.profile.planningRules))
      for (const b of portionOptionsFor(items[1],state.profile.planningRules))
        for (const c of portionOptionsFor(items[2],state.profile.planningRules)) {
          const entries=[a,b,c].flatMap((portions,i)=>portions?[{foodId:items[i].id,meal:'lunch',portions}]:[]);
          if (mealRuleIssues(entries,state.menu[0].lunch,foods,state.profile.planningRules).length) continue;
          const total=totals(entries,foods);
          if (Object.entries(upperLimits).some(([k,limit])=>total[k]>limit+.001)) continue;
          const days=Array.from({length:7},(_,i)=>({entries:i===0?entries:[]}));
          best=Math.max(best,scoreStrategy({days},foods,target,state.profile).objectiveScore);
        }
    if (best===-Infinity) assert.throws(()=>generatePlan(state,foods,target,start),error=>error.status===422);
    else {
      const plan=generatePlan(state,foods,target,start);
      assert.ok(Math.abs(scoreStrategy(plan,foods,target,state.profile).objectiveScore-best)<1e-8,`seed ${seed}, shared ${consistentPortions}`);
      assert.deepEqual(mealRuleIssues(plan.days[0].entries,state.menu[0].lunch,foods,state.profile.planningRules),[]);
    }
  }
});

test('food and ingredient exclusions and dairy-free settings are applied before enforcing groups', () => {
  const items=[dish('base','A'),{...dish('excluded','B'),ingredients:[{foodId:'ingredient'}]}, {...dish('dairy','B'),dairy:true},dish('safe','B')];
  const {state,foods,target}=fixture(items);
  state.profile.excluded=['ingredient']; state.profile.dairyFree=true;
  state.menu=Array.from({length:7},()=>({...emptyDay(),lunch:items.map(f=>f.id)}));
  const plan=generatePlan(state,foods,target,start);
  assert.ok(plan.days.every(day=>day.entries.some(e=>e.foodId==='safe'&&e.portions>=1)));
  assert.ok(plan.days.every(day=>day.entries.every(e=>!['excluded','dairy'].includes(e.foodId))));
});

test('same food at the same meal shares portions; breakfast and lunch remain independent', () => {
  const p=targets(newStudent().profile);
  const items=[dish('rice','C',{...p,calories:p.calories/2,protein:p.protein/2,carbs:p.carbs/2,fat:p.fat/2,calcium:1000}),dish('Roti','A',{calcium:700},'1 roti'),dish('dal','B',{calcium:600})];
  const {state,foods,target}=fixture(items);
  state.menu[0].breakfast=['rice']; state.menu[1].breakfast=['rice'];
  state.menu[2].lunch=['rice','Roti','dal']; state.menu[3].lunch=['dal','rice','Roti'];
  const plan=generatePlan(state,foods,target,start);
  const amount=(day,meal)=>plan.days[day].entries.find(e=>e.foodId==='rice'&&e.meal===meal)?.portions||0;
  assert.equal(amount(0,'breakfast'),amount(1,'breakfast'));
  assert.equal(amount(2,'lunch'),amount(3,'lunch'));
  assert.ok(amount(0,'breakfast')>amount(2,'lunch'));
  for (const day of plan.days) for (const [k,limit] of Object.entries(upperLimits)) assert.ok(day.total[k]<=limit+.001,k);
  assert.ok(!scoreStrategy(plan,foods,target,state.profile,state).overrides.some(o=>o.message.includes('same portions')));
});

test('new defaults add exactly one milk and curd serving every day without duplicates', () => {
  const state=newStudent(); state.menu=structuredClone(messMenuPreset.menu);
  const original=structuredClone(state);
  const plan=generatePlan(state,catalog,targets(state.profile),start);
  for (const day of plan.days) for (const spec of dailyFoods) {
    assert.equal(day.entries.filter(e=>spec.ids.includes(e.foodId)).reduce((sum,e)=>sum+e.portions,0),1,`${day.date}: ${spec.label}`);
  }
  const portions=new Map();
  for (const day of plan.days) for (const e of day.entries) {
    const key=`${e.meal}:${e.foodId}`;
    if (portions.has(key)) assert.equal(e.portions,portions.get(key),key);
    portions.set(key,e.portions);
    assert.ok(Number.isInteger(e.portions/portionStep(catalog.get(e.foodId))));
  }
  assert.deepEqual(state,original,'generation must not modify menus, preferences or journal');
  const overrides=scoreStrategy(plan,catalog,targets(state.profile),state.profile,state).overrides;
  assert.ok(overrides.every(o=>o.message.startsWith('No ')),JSON.stringify(overrides));
});

test('daily additions respect exclusions, dairy-free preferences, attendance and explicit skips', () => {
  const {state}=fixture([],{dailyMilk:true,dailyCurd:true});
  state.attendance[0].breakfast=false;
  state.completedMeals=[{date:start,meal:'lunch'}];
  let plan=generatePlan(state,catalog,targets(state.profile),start);
  assert.ok(plan.days[0].entries.every(e=>e.meal==='dinner'));
  assert.equal(plan.days[0].entries.length,2);
  state.profile.dairyFree=true;
  plan=generatePlan(state,catalog,targets(state.profile),start);
  assert.ok(plan.days.every(day=>day.entries.length===0));
  state.profile.dairyFree=false; state.profile.excluded=['milk','curd'];
  plan=generatePlan(state,catalog,targets(state.profile),start);
  assert.ok(plan.days.every(day=>day.entries.length===0));
  assert.ok(plan.days.every(day=>day.warnings.some(w=>w.includes('Daily milk default skipped'))));
  state.profile.excluded=[];state.attendance=state.attendance.map(()=>({breakfast:false,lunch:false,dinner:false,snacks:false}));
  plan=generatePlan(state,catalog,targets(state.profile),start);
  assert.ok(plan.days.every(day=>day.entries.length===0));
});

test('logged daily foods count toward defaults and existing upper-limit overages are preserved', () => {
  const {state}=fixture([],{dailyMilk:true,dailyCurd:true,consistentPortions:false});
  state.logs=[{date:start,meal:'breakfast',foodId:'milk',portions:1},{date:start,meal:'breakfast',foodId:'curd',portions:.5}];
  let plan=generatePlan(state,catalog,targets(state.profile),start);
  assert.equal(plan.days[0].entries.some(e=>e.foodId==='milk'),false);
  assert.equal(plan.days[0].entries.find(e=>e.foodId==='curd').portions,.5);
  const items=[dish('over','C',{calcium:3000}),dish('safe','C',{calcium:0})];
  const fixture2=fixture(items,{consistentPortions:false});
  fixture2.state.logs=[{date:start,meal:'breakfast',foodId:'over',portions:1}];
  fixture2.state.menu[0].lunch=['over','safe'];
  plan=generatePlan(fixture2.state,fixture2.foods,fixture2.target,start);
  assert.equal(plan.days[0].total.calcium,3000);
  assert.ok(plan.days[0].entries.every(e=>e.foodId==='safe'));
});

test('manual strategies report daily-default and cross-day consistency overrides without rejecting them', () => {
  const state=newStudent(),days=Array.from({length:7},()=>({entries:[]}));
  days[0].entries=[{foodId:'milk',meal:'breakfast',portions:2}];
  days[1].entries=[{foodId:'milk',meal:'breakfast',portions:1}];
  const score=scoreStrategy({days},catalog,targets(state.profile),state.profile,state);
  assert.ok(score.overrides.some(o=>o.message.includes('Daily milk')));
  assert.ok(score.overrides.some(o=>o.message.includes('Daily curd')));
  assert.ok(score.overrides.some(o=>o.message.includes('same portions at breakfast')));
});
