import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

async function until(predicate) {
  const deadline=Date.now()+2000;
  while(!predicate()){assert.ok(Date.now()<deadline,'Planner UI did not settle');await new Promise(resolve=>setTimeout(resolve,5));}
}
const emptyMeal = () => ({breakfast:[],lunch:[],dinner:[],snacks:[]});
function plan(start) {
  return {start,days:Array.from({length:7},()=>({total:{calories:0,protein:0,carbs:0,fat:0},entries:[],warnings:[],loggedMeals:[]})),
    weekly:{},unknown:[],gaps:[],method:'Test plan',calorieCap:2000};
}
async function browser(savedStart,weekStart='2026-11-02') {
  const data={today:weekStart,weekStart,profile:{name:'Student'},collegeName:'Test hostel',logs:[],estimatedLogs:[],extras:[],strategies:[],activations:[],
    menu:Array.from({length:7},emptyMeal),attendance:Array.from({length:7},()=>({breakfast:true,lunch:true,dinner:true,snacks:true})),
    nutrients:{calories:{name:'Energy',unit:'kcal'},protein:{name:'Protein',unit:'g'},carbs:{name:'Carbs',unit:'g'},fat:{name:'Fat',unit:'g'}},
    targets:{calories:2000,protein:60,carbs:250,fat:60},plan:savedStart?plan(savedStart):null,
    // Existing accounts can have rules saved before the daily fields existed.
    planningRules:{minimums:{roti:2,dosa:1,paratha:1,idli:2},requireGroups:true,groupMinimumA:1,groupMinimumB:1,overrides:[]}};
  const errors=[],vc=new VirtualConsole();vc.on('jsdomError',error=>errors.push(error));
  const dom=new JSDOM(await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8'),{url:'http://localhost/#planner',runScripts:'outside-only',virtualConsole:vc});
  const w=dom.window,posts=[],timeouts=new Map();
  const set=w.setTimeout.bind(w),clear=w.clearTimeout.bind(w);
  w.setTimeout=(callback,ms,...args)=>{const id=set(callback,ms,...args);if(ms===60000)timeouts.set(id,callback);return id;};
  w.clearTimeout=id=>{timeouts.delete(id);clear(id);};
  w.structuredClone=structuredClone;w.scrollTo=()=>{};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const control={data,posts,timeouts,errors,q:selector=>w.document.querySelector(selector),w};
  w.fetch=async(path,options={})=>{
    if(path==='/api/state'){
      if(control.failRefresh)throw new TypeError('Network unavailable');
      return new Response(JSON.stringify(data));
    }
    if(path==='/api/plan'){
      const body=JSON.parse(options.body);posts.push(body);
      if(control.hang) return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new w.DOMException('Aborted','AbortError')),{once:true}));
      data.plan=plan(body.start);return new Response(JSON.stringify(data));
    }
    return new Response(JSON.stringify({foods:[],colleges:[],report:{}}));
  };
  w.eval(await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8'));
  await until(()=>control.q('#week-start'));
  return control;
}

test('an expired saved plan opens the current week and legacy accounts show the new daily defaults',async()=>{
  const b=await browser('2026-10-26');
  try{
    assert.equal(b.q('#week-start').value,'2026-11-02');
    for(const key of ['dailyMilk','dailyCurd','consistentPortions'])assert.equal(b.q(`[name="${key}"]`).checked,true);
    b.q('[data-action="generate"]').click();
    await until(()=>b.posts.length===1&&!b.q('[data-action="generate"]').disabled);
    assert.equal(b.posts[0].start,'2026-11-02');
    assert.deepEqual(b.errors,[]);
  }finally{b.w.close();}
});

test('generation refreshes the current week when a tab crosses Monday',async()=>{
  const b=await browser('2026-10-26','2026-10-26');
  try{
    b.data.weekStart='2026-11-02';b.data.today='2026-11-02';
    b.q('[data-action="generate"]').click();
    await until(()=>b.posts.length===1&&!b.q('[data-action="generate"]').disabled);
    assert.equal(b.posts[0].start,'2026-11-02');
    assert.equal(b.q('#week-start').value,'2026-11-02');
    assert.deepEqual(b.errors,[]);
  }finally{b.w.close();}
});

test('generation preserves a selected future week',async()=>{
  const b=await browser('2026-11-09');
  try{
    assert.equal(b.q('#week-start').value,'2026-11-09');
    b.q('[data-action="generate"]').click();
    await until(()=>b.posts.length===1&&!b.q('[data-action="generate"]').disabled);
    assert.equal(b.posts[0].start,'2026-11-09');
    assert.deepEqual(b.errors,[]);
  }finally{b.w.close();}
});

test('generation displays the one-minute message, aborts at the timeout and enables retry',async()=>{
  const b=await browser();
  try{
    b.hang=true;b.q('[data-action="generate"]').click();
    await until(()=>b.posts.length===1);
    assert.equal(b.q('#plan-generation-status').hidden,false);
    assert.match(b.q('#plan-generation-status').textContent,/may take up to 1 minute/);
    assert.equal(b.q('[data-action="generate"]').disabled,true);
    assert.equal(b.timeouts.size,1,'Only the pending request timeout should remain');
    for(const callback of b.timeouts.values())callback();
    await until(()=>!b.q('[data-action="generate"]').disabled);
    assert.match(b.q('#toast').textContent,/timed out after 60 seconds/);
    assert.equal(b.q('#plan-generation-status').hidden,true);
    b.hang=false;b.q('[data-action="generate"]').click();
    await until(()=>b.posts.length===2&&!b.q('[data-action="generate"]').disabled);
    assert.deepEqual(b.errors,[]);
  }finally{b.w.close();}
});

test('a failed week refresh does not submit a stale plan and restores the controls',async()=>{
  const b=await browser();
  try{
    b.failRefresh=true;b.q('[data-action="generate"]').click();
    await until(()=>!b.q('[data-action="generate"]').disabled);
    assert.equal(b.posts.length,0);
    assert.match(b.q('#toast').textContent,/Network unavailable/);
    assert.deepEqual(b.errors,[]);
  }finally{b.w.close();}
});
