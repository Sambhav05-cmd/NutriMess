import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { JSDOM, VirtualConsole } from 'jsdom';

async function browser() {
  const html=await fs.readFile(new URL('../public/index.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'http://172.25.39.173:3000/?debug=1',runScripts:'outside-only',virtualConsole:new VirtualConsole()});
  dom.window.eval(await fs.readFile(new URL('../public/debug.js',import.meta.url),'utf8'));
  return dom;
}
async function until(predicate) {
  const deadline=Date.now()+2000;
  while(!predicate()){assert.ok(Date.now()<deadline,'Startup state did not settle');await new Promise(resolve=>setTimeout(resolve,5));}
}

test('startup reports failed sign-in options and retry reaches the login screen',async()=>{
  const dom=await browser(),w=dom.window;
  let failOptions=true;
  w.fetch=async path=>{
    if(path==='/api/state')return new Response(JSON.stringify({error:'Please log in'}),{status:401});
    if(failOptions)throw new TypeError('Network connection lost');
    return new Response(JSON.stringify({colleges:[]}));
  };
  try {
    w.eval(await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8'));
    await until(()=>w.document.querySelector('[data-action="startup-retry"]'));
    assert.match(w.document.querySelector('#app').textContent,/Network connection lost/);
    assert.equal(w.document.querySelector('#startup-debug').hidden,false);
    const trace=w.document.querySelector('#startup-debug-output').textContent;
    assert.match(trace,/App script executing/);assert.match(trace,/auth\/options failed/);
    failOptions=false;
    w.document.querySelector('[data-action="startup-retry"]').click();
    await until(()=>w.document.querySelector('#auth-form'));
    assert.match(w.document.querySelector('#startup-debug-output').textContent,/Sign-in screen ready/);
  } finally {w.close();}
});

test('early diagnostics exposes an app-script load failure before app initialization',async()=>{
  const dom=await browser(),w=dom.window;
  try {
    w.document.querySelector('script[src="/app.js"]').dispatchEvent(new w.Event('error'));
    assert.equal(w.document.querySelector('#startup-debug').hidden,false);
    assert.match(w.document.querySelector('#startup-debug-output').textContent,/Asset failed: \/app.js/);
    assert.match(w.document.querySelector('#startup-debug-output').textContent,/HTTP\/HTTPS/);
  } finally {w.close();}
});
