import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultPlanningRules, minimumPortions, mealRuleIssues } from '../server/planning-rules.js';
import { generatePlan, scoreStrategy } from '../server/planner.js';
import { catalog } from '../server/catalog.js';
import { newStudent } from '../server/accounts.js';
import { zero, targets, shiftDate } from '../server/nutrition.js';
import { intakeHistory, retentionFor } from '../server/turnover.js';

const dish = (id, name, group, serving='1 piece', nutrients={}) => ({ id, name, planningGroup:group, serving, ingredients:[], nutrients:{...zero(),calories:100,protein:5,carbs:10,fat:3,...nutrients} });
const week = entries => Array.from({length:7},()=>({entries:structuredClone(entries)}));
function fixture(items) {
  const student=newStudent(), foods=new Map(items.map(f=>[f.id,f]));
  student.menu=Array.from({length:7},()=>({breakfast:items.map(f=>f.id),lunch:[],dinner:[],snacks:[]}));
  return {student,foods,target:targets(student.profile)};
}

test('NITK foods have explicit stable A/B/C classifications; other foods default to C',()=>{
  const map=new Map(catalog.map(f=>[f.id,f]));
  assert.equal(catalog.filter(f=>f.id.startsWith('nitk-')).length,96);
  for(const f of catalog)assert.ok(['A','B','C'].includes(f.planningGroup));
  for(const f of catalog.filter(f=>!f.id.startsWith('nitk-')))assert.equal(f.planningGroup,'C');
  for(const id of ['nitk-chapati','nitk-idli-3','nitk-masala-dosa-1','nitk-aloo-paratha-2','nitk-rice','nitk-poha-peanuts','nitk-vada-2'])assert.equal(map.get(id).planningGroup,'A',id);
  for(const id of ['nitk-tondakai-palya','nitk-dal-tadka','nitk-rasam','nitk-sambar','nitk-beetroot-palya'])assert.equal(map.get(id).planningGroup,'B',id);
  assert.equal(map.get('nitk-bread').planningGroup,'C');
});

test('minimum piece counts account for bundled source servings',()=>{
  const rules=defaultPlanningRules();
  assert.equal(minimumPortions(dish('a','Roti','A','2 medium rotis'),rules),1);
  assert.equal(minimumPortions(dish('b','Idli','A','3 medium idlis'),rules),1);
  assert.equal(minimumPortions(dish('unclassified','Roti','C','1 roti'),rules),0);
  assert.equal(minimumPortions(dish('c','Chapati','A','1 chapati'),rules),2);
  assert.equal(minimumPortions(dish('d','Rice','A','1 bowl'),rules),0);
});

test('planner enforces piece minima and one whole A/B choice per meal, with editable settings',()=>{
  const {student,foods,target}=fixture([dish('roti','Roti','A'),dish('dosa','Dosa','A'),dish('paratha','Paratha','A'),dish('idli','Idli','A'),dish('dal','Dal','B','1 bowl')]);
  let plan=generatePlan(student,foods,target,'2026-11-02');
  for(const day of plan.days){
    for(const [foodId,min] of Object.entries({roti:2,dosa:1,paratha:1,idli:2,dal:1}))assert.ok(day.entries.find(e=>e.foodId===foodId)?.portions>=min,foodId);
    assert.deepEqual(mealRuleIssues(day.entries,student.menu[0].breakfast,foods,student.profile.planningRules),[]);
  }
  student.profile.planningRules.minimums.roti=3;
  student.profile.planningRules.groupMinimumB=1.5;
  plan=generatePlan(student,foods,target,'2026-11-02');
  assert.ok(plan.days.every(day=>day.entries.find(e=>e.foodId==='roti').portions===3&&day.entries.find(e=>e.foodId==='dal').portions>=1.5));
  student.profile.planningRules={...defaultPlanningRules(),minimums:{roti:0,dosa:0,paratha:0,idli:0},requireGroups:false};
  student.profile.calorieCap=100;
  plan=generatePlan(student,foods,target,'2026-11-02');
  assert.ok(plan.days.some(day=>!day.entries.some(e=>e.foodId==='roti'&&e.portions>=2)));
});

test('missing group options are reported; manual overrides remain scoreable; impossible hard rules fail clearly',()=>{
  const {student,foods,target}=fixture([dish('roti','Roti','A')]);
  const plan=generatePlan(student,foods,target,'2026-11-02');
  assert.ok(plan.days.every(day=>day.entries.length&&day.warnings.some(w=>w.includes('No group B'))));
  const manual={days:week([{foodId:'roti',meal:'breakfast',portions:1}])};
  const score=scoreStrategy(manual,foods,target,student.profile,student);
  assert.ok(score.value>=0&&score.value<=100);
  assert.ok(score.overrides.some(issue=>issue.message.includes('minimum 2')));
  foods.get('roti').nutrients.calcium=2000;
  assert.throws(()=>generatePlan(student,foods,target,'2026-11-02'),error=>error.status===422&&error.message.includes('upper limits'));
});

test('strategy scores use the optimizer objective and expose incomplete values',()=>{
  const student=newStudent(), target=targets(student.profile), foods=new Map([['balanced',dish('balanced','Balanced','C','1 bowl',target)]]);
  const score=portions=>scoreStrategy({days:week([{foodId:'balanced',meal:'breakfast',portions}])},foods,target,student.profile);
  assert.equal(score(1).value,100);
  assert.ok(score(.5).value<score(1).value);
  assert.ok(score(2).value<score(1).value);
  assert.ok(score(1).objectiveScore>score(.5).objectiveScore);
  foods.get('balanced').nutrients.b12=null;
  assert.ok(score(1).incomplete.includes('b12'));
});

test('new-account 100% history baseline decays without inventing food intake',()=>{
  const student=newStudent(), target=targets(student.profile), baseline={...student.nutritionBaseline,date:'2026-11-02'};
  const first=intakeHistory([],new Map(),target,'2026-11-02',baseline);
  for(const h of Object.values(first)){
    assert.equal(h.historyCoverage,1);assert.equal(h.retainedTargetDays,0);assert.equal(h.todayCoverage,0);assert.equal(h.initialStores,'unknown');
  }
  const next=intakeHistory([],new Map(),target,'2026-11-03',baseline);
  assert.equal(next.b12.historyCoverage,retentionFor('b12'));
  assert.equal(next.calories.historyCoverage,0);
  assert.equal(intakeHistory([],new Map(),target,'2026-11-02').b12.historyCoverage,0,'existing accounts do not gain a baseline');
  assert.deepEqual(student.logs,[]);
});

test('HTTP rules persist, manual exceptions save, and login preserves the one-time baseline', {timeout:30000}, async()=>{
  process.env.DB_PATH=':memory:';
  const {app,storage}=await import('../server/index.js?planning-rules');
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  let cookie='';
  const request=async(route,method='GET',body)=>{
    const res=await fetch(`http://127.0.0.1:${server.address().port}/api/${route}`,{method,headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    return {status:res.status,data:await res.json()};
  };
  const signup={email:'rules@example.com',password:'test-password',name:'Rules',gender:'male',collegeId:'nitk-uploaded'};
  try{
    const registered=await request('auth/register','POST',signup);
    assert.equal(registered.status,200);
    assert.ok(Object.values(registered.data.intakeHistory).every(h=>h.historyCoverage===1));
    assert.ok(Object.values(registered.data.todayTotals).every(n=>n===0));
    let ready=registered.data;
    const deadline=Date.now()+20000;
    while(ready.initialPlan.status==='pending'){
      assert.ok(Date.now()<deadline);await new Promise(resolve=>setTimeout(resolve,30));ready=(await request('state')).data;
    }
    assert.equal(ready.initialPlan.status,'ready');
    assert.ok(ready.plan.strategyScore.value>=0);
    const rules=defaultPlanningRules();rules.minimums.roti=3;rules.overrides=[{foodId:'nitk-curd',group:'B'}];
    const saved=await request('planning-rules','PUT',rules);
    assert.equal(saved.status,200);assert.deepEqual(saved.data.planningRules,rules);
    assert.equal((await request('planning-rules','PUT',{...rules,minimums:{...rules.minimums,roti:-1}})).status,400);
    const profile=await request('profile','PUT',saved.data.profile);
    assert.equal(profile.status,200);assert.deepEqual(profile.data.planningRules,rules);
    const manual={name:'I choose one roti',days:week([{foodId:'nitk-chapati',meal:'lunch',portions:1}])};
    const scored=await request('strategies/score','POST',manual);
    assert.equal(scored.status,200);assert.ok(scored.data.overrides.some(issue=>issue.message.includes('minimum 3')));
    const strategy=await request('strategies','POST',manual);
    assert.equal(strategy.status,201,'manual strategies can override the optimizer rules');
    assert.equal(strategy.data.strategyScores[strategy.data.strategies[0].id].value,scored.data.value);
    const account=await storage.findAccount(signup.email), current=await storage.getStudent(account.id);
    current.student.nutritionBaseline.date=shiftDate(current.student.nutritionBaseline.date,-1);
    current.student.activations=[];current.student.plan=null;
    await storage.saveStudent(account.id,current.student,current.revision);
    await request('auth/logout','POST',{});
    const login=await request('auth/login','POST',signup);
    assert.equal(login.status,200);
    assert.equal(login.data.nutritionBaseline.date,current.student.nutritionBaseline.date);
    assert.equal(login.data.intakeHistory.b12.historyCoverage,retentionFor('b12'));
    assert.equal(login.data.logs.length,0);
    assert.ok(Object.values(login.data.todayTotals).every(n=>n===0));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await storage.close();}
});
