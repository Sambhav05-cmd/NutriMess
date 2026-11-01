import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
process.env.DB_PATH=':memory:';
const { app } = await import('../server/index.js');
const { monday, dateKey, shiftDate } = await import('../server/nutrition.js');

test('API persists a profile, isolates sessions, validates writes, logs meals and builds plans',async()=>{
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/`;
  let cookie='';
  async function request(route,method='GET',body,useCookie=true){
    const res=await fetch(base+route,{method,headers:{...(useCookie?{cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(useCookie&&res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    return {status:res.status,data:await res.json()};
  }
  try {
    assert.equal((await request('state')).status,401);
    assert.equal((await request('auth/register','POST',{email:'asha@example.com',password:'long-test-password',name:'Student',sex:'male',gender:'Man',collegeId:'custom'})).status,200);
    const initial=await request('state');assert.equal(initial.status,200);assert.ok(cookie.includes('nutrimess='));
    const p={...initial.data.profile,name:'Asha',gender:'female',weight:55};
    assert.equal((await request('profile','PUT',{...p,weight:-1})).status,400);
    assert.equal((await request('profile','PUT',p)).data.profile.name,'Asha');
    assert.equal((await request('state')).data.profile.name,'Asha');
    assert.equal((await request('state','GET',null,false)).status,401);
    const cross=await fetch(base+'profile',{method:'PUT',headers:{cookie,Origin:'https://other.example','Content-Type':'application/json'},body:JSON.stringify(p)});assert.equal(cross.status,403);
    assert.equal((await request('logs','POST',{date:dateKey(),meal:'breakfast',foodId:'no-such-food',portions:1})).status,400);
    assert.equal((await request('logs','POST',{date:'2026-02-30',meal:'breakfast',foodId:'milk',portions:1})).status,400);
    assert.equal((await request('logs','POST',{date:shiftDate(dateKey(),1),meal:'breakfast',foodId:'milk',portions:1})).status,400);
    const logged=await request('logs','POST',{date:dateKey(),meal:'breakfast',foodId:'milk',portions:1});
    assert.equal(logged.status,200);assert.ok(logged.data.todayTotals.calories>0);
    const planned=await request('plan','POST',{start:monday(dateKey())});
    assert.equal(planned.status,200);assert.equal(planned.data.plan.days.length,7);
    assert.ok(planned.data.plan.days.every(d=>d.entries.length>0),'Reusable suggestions must include earlier weekdays');
    assert.deepEqual(planned.data.logs,logged.data.logs,'Generating a strategy must not rewrite actual logs');
    const today=planned.data.plan.days.find(d=>d.date===dateKey());assert.ok(today.entries.some(e=>e.meal==='breakfast'));
    const lunch=today.entries.find(e=>e.meal==='lunch');
    if(lunch){const meal=await request('plan/log-meal','POST',{date:dateKey(),meal:'lunch'});assert.equal(meal.status,200);assert.ok(meal.data.logs.some(l=>l.meal==='lunch'));assert.equal((await request('plan/log-meal','POST',{date:dateKey(),meal:'lunch'})).status,400);}
    const entryId=logged.data.logs[0].id;
    assert.equal((await request(`logs/${entryId}`,'DELETE')).status,200);
    assert.equal((await request('menu','PUT',{menu:[],attendance:[]})).status,400);
    const largeMenu=structuredClone(initial.data.menu);
    const manyFoods=(await request('catalog')).data.foods.slice(0,40).map(f=>f.id);
    largeMenu[0].breakfast=manyFoods;
    const menuSaved=await request('menu','PUT',{menu:largeMenu,attendance:initial.data.attendance,collegeName:'Large menu',collegeId:'custom'});
    assert.equal(menuSaved.status,200);assert.deepEqual(menuSaved.data.menu[0].breakfast,manyFoods);
    const largeStrategy=await request('strategies','POST',{name:'Many dishes',days:Array.from({length:7},()=>({entries:manyFoods.map(foodId=>({foodId,meal:'breakfast',portions:1}))}))});
    assert.equal(largeStrategy.status,201);
    assert.equal(largeStrategy.data.strategies.at(-1).days[0].entries.length,40);
    assert.equal((await request('colleges','POST',{name:'My actual college',menu:initial.data.menu})).status,201);
    assert.ok((await request('catalog')).data.colleges.some(c=>c.name==='My actual college'));
    assert.equal((await request('extras','POST',{date:dateKey(),meal:'snacks',foodId:'guava'})).status,200);
    const beforeMeal=(await request('state')).data;
    const putMeal=(entries,expectedLogIds=[])=>request('logs/meal','PUT',{date:dateKey(),meal:'dinner',entries,expectedLogIds});
    const savedMeal=await putMeal([{foodId:'rice',portions:1},{foodId:'curd',portions:1.5},{foodId:'rice',portions:.5}]);
    assert.equal(savedMeal.status,200);
    const dinner=savedMeal.data.logs.filter(l=>l.date===dateKey()&&l.meal==='dinner');
    assert.equal(dinner.length,2);
    assert.equal(dinner.find(l=>l.foodId==='rice').portions,1.5);
    assert.equal(dinner.find(l=>l.foodId==='curd').portions,1.5);
    assert.deepEqual(savedMeal.data.menu,beforeMeal.menu);
    assert.deepEqual(savedMeal.data.logs.filter(l=>l.meal!=='dinner'),beforeMeal.logs.filter(l=>l.meal!=='dinner'));
    const expected=dinner.map(l=>l.id);
    const invalid=await putMeal([{foodId:'milk',portions:1},{foodId:'curd',portions:-1}],expected);
    assert.equal(invalid.status,400);
    assert.deepEqual((await request('state')).data.logs,savedMeal.data.logs,'Invalid meals must not partially replace logs');
    const replaced=await putMeal([{foodId:'curd',portions:.5}],expected);
    assert.equal(replaced.status,200);
    assert.equal(replaced.data.logs.filter(l=>l.meal==='dinner').length,1);
    assert.equal((await putMeal([{foodId:'rice',portions:1}],expected)).status,409,'Stale edits must not overwrite a newer meal');
    assert.equal((await request('state')).data.logs.find(l=>l.meal==='dinner').portions,.5);
    const clear=await putMeal([],replaced.data.logs.filter(l=>l.meal==='dinner').map(l=>l.id));
    assert.equal(clear.status,200);
    assert.ok(!clear.data.logs.some(l=>l.meal==='dinner'));
    assert.ok(clear.data.turnoverEvidence.nutrients.b12.lossFractionPerDay===.001);
    assert.ok(clear.data.intakeHistory.calories.mode==='daily');
    assert.ok(!('decay' in clear.data.profile));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('single gender and short passwords work, and generated strategies retain all seven days independently of the journal',async()=>{
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/`;let cookie='';
  async function request(route,method='GET',body){
    const res=await fetch(base+route,{method,headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    return {status:res.status,data:await res.json()};
  }
  try {
    const signup={email:'short-password@example.com',password:'p',name:'Test',gender:'female',collegeId:'custom'};
    assert.equal((await request('auth/register','POST',{...signup,password:''})).status,400);
    assert.equal((await request('auth/register','POST',{...signup,password:'x'.repeat(129)})).status,400);
    let state=await request('auth/register','POST',signup);
    assert.equal(state.status,200);assert.equal(state.data.profile.gender,'female');assert.equal(state.data.profile.height,151);assert.equal(state.data.targets.iron,18);
    assert.ok(!('sex' in state.data.profile));
    await request('auth/logout','POST',{});
    assert.equal((await request('auth/login','POST',{email:signup.email,password:'p'})).status,200);
    state=await request('profile','PUT',{...state.data.profile,gender:'male'});
    assert.equal(state.status,200);assert.equal(state.data.targets.iron,8);assert.ok(!('sex' in state.data.profile));
    assert.equal((await request('profile','PUT',{...state.data.profile,gender:'invalid'})).status,400);
    await request('logs','POST',{date:dateKey(),meal:'breakfast',foodId:'rice',portions:1});
    const skipped=await request('logs/meal','PUT',{date:dateKey(),meal:'dinner',entries:[],expectedLogIds:[]});
    const planned=await request('plan','POST',{start:monday()});assert.equal(planned.status,200);
    const plan=planned.data.plan;
    assert.equal(plan.days.length,7);
    for(const day of plan.days){assert.ok(day.entries.length>0,`${day.date} is empty`);assert.ok(day.entries.some(e=>e.meal==='dinner'));assert.deepEqual(day.loggedMeals,[]);}
    assert.deepEqual(planned.data.logs,skipped.data.logs);assert.deepEqual(planned.data.completedMeals,skipped.data.completedMeals);
    const saved=await request('strategies','POST',{name:'Complete weekly strategy',days:plan.days.map(d=>({entries:d.entries}))});
    assert.equal(saved.status,201);assert.ok(saved.data.strategies.at(-1).days.slice(0,4).every(d=>d.entries.length>0));
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
