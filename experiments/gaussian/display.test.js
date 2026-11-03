import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {JSDOM,VirtualConsole} from 'jsdom';
import {newStudent} from '../../server/accounts.js';
import {nutrients,targets} from '../../server/nutrition.js';

test('saved Gaussian scores remain readable when their products are tiny or underflow', async () => {
  const state=newStudent();
  const strategy={id:'tiny',name:'Tiny Gaussian',notes:'',updatedAt:'2026-11-02',days:Array.from({length:7},()=>({entries:[]}))};
  Object.assign(state,{today:'2026-11-02',weekStart:'2026-11-02',nutrients,targets:targets(state.profile),
    estimatedLogs:[],strategies:[strategy],strategyScores:{tiny:{value:0,logScore:-1000,experimental:true,incomplete:[],overrides:[]}},
    scoringMode:{id:'gaussian',label:'Experimental Gaussian planner',calorieVariance:.0001}});
  const dom=new JSDOM(await fs.readFile(new URL('../../public/index.html',import.meta.url),'utf8'),{
    url:'http://localhost/#strategies',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  try {
    const w=dom.window;
    w.fetch=async path=>new Response(JSON.stringify(path==='/api/state'?state:{foods:[],colleges:[],report:{}}));
    w.structuredClone=structuredClone;w.scrollTo=()=>{};
    w.eval(await fs.readFile(new URL('../../public/app.js',import.meta.url),'utf8'));
    const deadline=Date.now()+2000;
    while(!w.document.querySelector('[data-strategy-stats="tiny"]')){
      assert.ok(Date.now()<deadline,w.document.body.textContent);
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    const score=w.document.querySelector('[data-strategy-stats="tiny"] .strategy-score');
    assert.match(score.textContent,/Strategy score: [\d.]+e-\d+ \/ 100/);
    assert.doesNotMatch(score.textContent,/Strategy score: 0 \/ 100/);
    // The editor reuses this formatter; a representable small product also
    // stays readable and the main scorer retains its normal decimal format.
    assert.equal(w.eval('formatPlanScore({experimental:true,value:0.00140989,logScore:Math.log(0.00140989/100)})'),'1.41e-3');
    assert.equal(w.eval('formatPlanScore({value:73.2})'),'73.2');
  } finally {dom.window.close();}
});
