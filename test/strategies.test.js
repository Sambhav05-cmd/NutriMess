import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { newStudent } from '../server/accounts.js';
import { effectiveIntake } from '../server/strategies.js';
import { dateKey, shiftDate } from '../server/nutrition.js';
process.env.DB_PATH=':memory:';
const { app }=await import('../server/index.js');
const week=(foodId='milk')=>Array.from({length:7},()=>({entries:[{foodId,meal:'breakfast',portions:1}]}));

test('missed meals derive from historical activation snapshots and actual or skipped meals override them',()=>{
  const s={logs:[],completedMeals:[],activations:[{from:'2026-10-01',name:'Original',days:week()},{from:'2026-10-15',name:'New',days:week('curd')}]};
  const now=new Date('2026-10-20T05:00:00Z'); // 10:30 IST
  let estimates=effectiveIntake(s,now);
  assert.equal(estimates.length,20,'absence across several weeks is covered without a background job');
  assert.ok(estimates.filter(e=>e.date<'2026-10-15').every(e=>e.foodId==='milk'));
  assert.ok(estimates.filter(e=>e.date>='2026-10-15').every(e=>e.foodId==='curd'));
  assert.equal(effectiveIntake(s,new Date('2026-10-20T03:00:00Z')).length,19,'today’s unfinished meal is not assumed');
  s.logs=[{date:'2026-10-16',meal:'breakfast',foodId:'rice',portions:1}];
  s.completedMeals=[{date:'2026-10-17',meal:'breakfast'}];
  estimates=effectiveIntake(s,now);
  assert.equal(estimates.length,18);
  assert.ok(!estimates.some(e=>['2026-10-16','2026-10-17'].includes(e.date)));
  assert.ok(estimates.every(e=>e.assumed&&e.date>='2026-10-01'&&e.date<='2026-10-20'));
});

test('accounts protect saved strategies, revisions, activation snapshots, PDF download and logging',async()=>{
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const base=`http://127.0.0.1:${server.address().port}/api/`;
  let cookie='';
  async function request(route,method='GET',body) {
    const res=await fetch(base+route,{method,headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    return {status:res.status,data:await res.json()};
  }
  const signup={email:'strategy@example.com',password:'a-strong-test-password',name:'Strategy Student',sex:'female',gender:'Woman',collegeId:'nitt-south'};
  try {
    assert.equal((await request('strategies','POST',{})).status,401);
    const options=await request('auth/options');assert.equal(options.data.colleges.filter(c=>c.sourceUrl).length,4);
    assert.ok(options.data.colleges.some(c=>c.id==='nitk-uploaded'));
    const registered=await request('auth/register','POST',signup);
    assert.equal(registered.status,200);assert.equal(registered.data.profile.height,151);assert.equal(registered.data.profile.weight,55);
    assert.equal(registered.data.collegeId,'nitt-south');assert.equal(registered.data.activations.length,1);
    const cookieBefore=cookie;
    assert.equal((await request('auth/logout','POST',{})).status,200);
    assert.equal((await request('state')).status,401);
    cookie=cookieBefore;assert.equal((await request('state')).status,401,'logout revokes the database session');
    assert.equal((await request('auth/login','POST',{...signup,password:'a-wrong-test-password'})).status,401);
    assert.equal((await request('auth/login','POST',signup)).status,200);assert.notEqual(cookie,cookieBefore);
    const body={name:'My strategy',notes:'Saved test approach',days:week()};
    const saved=await request('strategies','POST',body);assert.equal(saved.status,201);
    const strategy=saved.data.strategies.at(-1), id=strategy.id;
    assert.equal((await request(`strategies/${id}`,'PUT',{...strategy,days:week('no-such-food')})).status,400);
    assert.equal((await request(`strategies/${id}/activate`,'POST',{})).status,200);
    const updated=await request(`strategies/${id}`,'PUT',{...strategy,days:week('curd')});assert.equal(updated.status,200);
    assert.equal(updated.data.activations.at(-1).days[0].entries[0].foodId,'milk','editing must not rewrite active history');
    assert.equal((await request(`strategies/${id}`,'PUT',strategy)).status,409);
    assert.equal((await request(`strategies/${id}/log`,'POST',{date:shiftDate(dateKey(),1),meal:'breakfast'})).status,400);
    const logged=await request(`strategies/${id}/log`,'POST',{date:dateKey(),meal:'breakfast'});assert.equal(logged.status,200);
    assert.equal(logged.data.logs[0].foodId,'curd');assert.ok(!logged.data.estimatedLogs.some(e=>e.date===dateKey()&&e.meal==='breakfast'));
    assert.equal((await request(`strategies/${id}/log`,'POST',{date:dateKey(),meal:'breakfast'})).status,409);
    const pdf=await fetch(base+`strategies/${id}/pdf`,{headers:{cookie}});
    assert.equal(pdf.status,200);assert.match(pdf.headers.get('content-type'),/application\/pdf/);assert.match(pdf.headers.get('content-disposition'),/attachment/);
    const bytes=Buffer.from(await pdf.arrayBuffer());assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>2000);
    const ownerCookie=cookie;cookie='';
    assert.equal((await request('auth/register','POST',{...signup,email:'other@example.com'})).status,200);
    assert.equal((await request(`strategies/${id}`,'PUT',strategy)).status,404);
    assert.equal((await fetch(base+`strategies/${id}/pdf`,{headers:{cookie}})).status,404);
    cookie=ownerCookie;
    const deleted=await request(`strategies/${id}`,'DELETE');assert.equal(deleted.status,200);
    assert.equal(deleted.data.strategies.length,0);assert.equal(deleted.data.activations.at(-1).days[0].entries[0].foodId,'milk');
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('SQLite retains claimed legacy records, saved strategies and sessions across independent app instances',async()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'nutrimess-persistence-'));
  const filename=path.join(directory,'test.sqlite'), legacyId='11111111-1111-4111-8111-111111111111';
  const legacy=newStudent();legacy.profile.height=178;legacy.profile.weight=72;
  legacy.logs=[{id:'legacy-food',date:dateKey(),meal:'breakfast',foodId:'milk',portions:1}];
  const seed=new DatabaseSync(filename);seed.exec('CREATE TABLE students (id TEXT PRIMARY KEY, document TEXT NOT NULL)');seed.prepare('INSERT INTO students VALUES (?, ?)').run(legacyId,JSON.stringify(legacy));seed.close();
  process.env.DB_PATH=filename;
  const first=(await import('../server/index.js?persistence=first')).app.listen(0,'127.0.0.1');await once(first,'listening');
  let cookie=`nutrimess=${legacyId}`,base=`http://127.0.0.1:${first.address().port}/api/`;
  const request=async(route,method='GET',body)=>{
    const res=await fetch(base+route,{method,headers:{cookie,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});
    if(res.headers.get('set-cookie'))cookie=res.headers.get('set-cookie').split(';')[0];
    assert.equal(res.status<300,true,`${route}: ${res.status}`);return res.json();
  };
  try {
    const claimed=await request('auth/register','POST',{email:'legacy@example.com',password:'long-legacy-password',name:'Legacy Student',sex:'male',gender:'Man',collegeId:'custom'});
    assert.equal(claimed.profile.height,178);assert.equal(claimed.profile.weight,72);assert.equal(claimed.logs[0].id,'legacy-food');
    await request('strategies','POST',{name:'Persistent strategy',days:week()});
    first.closeAllConnections();await new Promise(resolve=>first.close(resolve));
    const second=(await import('../server/index.js?persistence=second')).app.listen(0,'127.0.0.1');await once(second,'listening');
    base=`http://127.0.0.1:${second.address().port}/api/`;
    try {
      const restored=await request('state');assert.equal(restored.strategies[0].name,'Persistent strategy');assert.equal(restored.logs[0].id,'legacy-food');
      const inspect=new DatabaseSync(filename);
      assert.equal(inspect.prepare('SELECT count(*) AS n FROM accounts').get().n,1);
      assert.equal(inspect.prepare('SELECT count(*) AS n FROM reference_documents').get().n,3);
      assert.ok(inspect.prepare('SELECT count(*) AS n FROM college_menus').get().n>=5);
      assert.ok(!inspect.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().some(t=>/pdf/i.test(t.name)));
      inspect.close();
      assert.ok(!fs.readdirSync(directory).some(n=>n.endsWith('.pdf')));
    }finally{second.closeAllConnections();await new Promise(resolve=>second.close(resolve));}
  }finally{if(first.listening){first.closeAllConnections();await new Promise(resolve=>first.close(resolve));}process.env.DB_PATH=':memory:';}
});
