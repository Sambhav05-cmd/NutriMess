import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import {newStudent} from '../server/accounts.js';
import {targets} from '../server/nutrition.js';
import {scoreStrategy as originalScore,portionOptionsFor as originalOptions} from '../server/legacy/planner.js';
import {scoreStrategy as currentScore,portionOptionsFor as currentOptions} from '../server/planner.js';

test('production defaults to Gaussian and explicitly supports main and original modes',()=>{
  for(const mode of [undefined,'gaussian','main','legacy']){
    const env={...process.env};delete env.NUTRIMESS_GAUSSIAN;delete env.NUTRIMESS_PLANNER;
    if(mode)env.NUTRIMESS_PLANNER=mode;
    const selector=spawnSync(process.execPath,['--input-type=module','-e',"const p=await import('./server/active-planner.js');console.log(JSON.stringify({id:p.scoringMode.id,generate:typeof p.generatePlan,check:typeof p.planningConflicts}));"],{env,encoding:'utf8'});
    assert.equal(selector.status,0,selector.stderr);
    const data=JSON.parse(selector.stdout.trim());
    assert.equal(data.id,mode||'gaussian');assert.equal(data.generate,'function');assert.equal(data.check,'function');
  }
});

test('original algorithm retains its calorie-underfill penalty and original portion range',()=>{
  const student=newStudent(),target=targets(student.profile);
  const f={id:'balanced',name:'Balanced',serving:'1 bowl',planningGroup:'C',ingredients:[],nutrients:{...target,calories:target.calories*.8}};
  const foods=new Map([[f.id,f]]),strategy={days:Array.from({length:7},()=>({entries:[{foodId:f.id,meal:'lunch',portions:1}]}))};
  assert.ok(originalScore(strategy,foods,target,student.profile,student).value<100);
  assert.equal(currentScore(strategy,foods,target,student.profile,student).value,100);
  assert.equal(originalOptions(f).at(-1),2);assert.equal(currentOptions(f).at(-1),5);
});

test('production storage keeps Atlas support and refuses an ephemeral production fallback',async()=>{
  const {openStorage}=await import('../server/storage.js');
  const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
  try{await assert.rejects(openStorage({catalog:[],uri:''}),/Set MONGODB_URI/);}
  finally{if(previous===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous;}
  assert.match(fs.readFileSync(new URL('../server/storage.js',import.meta.url),'utf8'),/openMongoStorage/);
});
