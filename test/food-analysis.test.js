import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the same browser calculations without starting the authenticated app.
const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const helpers=source.slice(source.indexOf('function nutrientDensity('),source.indexOf('function analysisMenuFoods('));
const context=vm.createContext({});
vm.runInContext(helpers,context);
const food=(id,calories,protein)=>({id,nutrients:{calories,protein}});

test('density ranks depend on nutrients per calorie, not serving size, and preserve ties',()=>{
  const a=food('a',200,20), b=food('b',50,10), c=food('c',100,20), d=food('d',100,0);
  const pool=[a,b,c,d];
  assert.equal(context.densityRank(a,'protein',pool).rank,3);
  assert.equal(context.densityRank(b,'protein',pool).rank,1);
  assert.equal(context.densityRank(c,'protein',pool).rank,1);
  assert.equal(context.densityRank(d,'protein',pool).score,0);
  assert.equal(context.nutrientDensity(a,'protein'),context.nutrientDensity(food('scaled',400,40),'protein'));
});

test('unknown, nonfinite and nonpositive calorie values cannot establish a rank',()=>{
  const valid=food('valid',100,5);
  for(const f of [food('missing',100,null),food('zero',0,2),food('negative',-10,2),food('nan',NaN,2),food('infinite',100,Infinity)]){
    assert.equal(context.nutrientDensity(f,'protein'),null);
    assert.equal(context.densityRank(f,'protein',[valid,f]),null);
    assert.equal(context.densityRank(valid,'protein',[valid,f]).count,1);
  }
  assert.equal(context.densityRank(valid,'protein',[valid]).score,100);
  const zero=food('zero nutrient',100,0);
  assert.equal(context.densityRank(zero,'protein',[zero]).score,0);
});

test('an outside food can be compared without changing the menu cohort',()=>{
  const menu=[food('a',100,10),food('b',100,5)], outside=food('outside',200,15);
  const result=context.densityRank(outside,'protein',[...menu,outside]);
  assert.equal(result.rank,2);assert.equal(result.count,3);assert.equal(menu.length,2);
});

test('food analysis UI searches outside the menu, changes leaderboards, and handles an empty menu',async()=>{
  const {JSDOM}=await import('jsdom');
  const dom=new JSDOM('<div id="app"></div><dialog id="dialog"></dialog><div id="toast"></div>',{url:'http://localhost',runScripts:'outside-only'});
  const w=dom.window,q=selector=>w.document.querySelector(selector);
  const definitions={calories:{name:'Energy',unit:'kcal'},protein:{name:'Protein',unit:'g'},fiber:{name:'Fiber',unit:'g'}};
  const fixtures=[
    {id:'a',name:'Menu lentils',serving:'1 bowl',nutrients:{calories:100,protein:10,fiber:5}},
    {id:'b',name:'Menu rice',serving:'1 bowl',nutrients:{calories:200,protein:5,fiber:null}},
    {id:'c',name:'Outside cheese',aliases:'paneer',serving:'100 g',nutrients:{calories:100,protein:20,fiber:0}}
  ].map(f=>({...f,source:'Fixture',basis:'Per serving'}));
  w.eval(source.replace('\ninit();','\n')+`\nstate={nutrients:${JSON.stringify(definitions)},menu:[{breakfast:['a','b'],lunch:['a']}]};catalog=${JSON.stringify(fixtures)};foodMap=new Map(catalog.map(f=>[f.id,f]));document.querySelector('#app').innerHTML=foodAnalysisPage();window.resetAnalysisFixture=()=>{state.menu=[];analysisFoodId=null;analysisQuery='';analysisScope='menu';document.querySelector('#app').innerHTML=foodAnalysisPage();};`);
  const click=s=>{assert.ok(q(s),s);q(s).click();};
  const change=(s,value)=>{q(s).value=value;q(s).dispatchEvent(new w.Event('change',{bubbles:true}));};
  const search=value=>{q('#analysis-search').value=value;q('#analysis-search').dispatchEvent(new w.Event('input',{bubbles:true}));};
  try {
    assert.equal(q('#analysis-food-list').querySelectorAll('button').length,2,'weekly menu duplicates appear once');
    assert.ok(q('.analysis-chart svg'));
    assert.doesNotMatch(q('.analysis-chart svg').textContent,/Energy|Calories/);
    assert.match(q('#analysis-detail').textContent,/100 kcal/);
    click('#analysis-food-list [data-food="b"]');
    assert.match(q('#analysis-detail').textContent,/Menu rice/);
    assert.match(q('#analysis-detail').textContent,/Unknown/);
    change('#analysis-nutrient','fiber');
    assert.equal(q('#analysis-ranking').querySelectorAll('tbody tr').length,1);
    change('#analysis-scope','catalog');
    assert.equal(q('#analysis-ranking').querySelectorAll('tbody tr').length,2);
    search('paneer');
    assert.match(q('#analysis-food-list').textContent,/Outside your menu · 1/);
    click('#analysis-food-list [data-food="c"]');
    assert.match(q('#analysis-detail').textContent,/would place when added/);
    assert.equal(q('#analysis-food-list [data-food="c"]').getAttribute('aria-pressed'),'true');
    search('no-match');
    assert.match(q('#analysis-food-list').textContent,/No other foods match/);
    w.resetAnalysisFixture();
    assert.match(q('#analysis-detail').textContent,/Your menu is empty/);
    assert.match(q('#analysis-ranking').textContent,/No foods with known/);
    search('cheese');click('#analysis-food-list [data-food="c"]');
    assert.ok(q('.analysis-chart svg'));
  }finally{w.close();}
});
