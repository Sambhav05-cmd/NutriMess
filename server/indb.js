import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nutrients } from './nutrition.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const normalize=s=>String(s||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const number=value=>value!==undefined&&String(value).trim()!==''&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const fields={calories:'energy_kcal',protein:'protein_g',carbs:'carb_g',fat:'fat_g',fiber:'fibre_g',vitaminC:'vitc_mg',b1:'vitb1_mg',b2:'vitb2_mg',b6:'vitb6_mg',folate:'folate_ug',calcium:'calcium_mg',iron:'iron_mg',magnesium:'magnesium_mg',zinc:'zinc_mg',potassium:'potassium_mg'};
// Reviewed equivalents to existing recipes; variants such as masala dosa remain distinct.
const equivalents={ASC096:'chapati',ASC144:'idli',ASC151:'dal',ASC215:'palak',BFP043:'upma',BFP044:'poha',BFP045:'poha',BFP144:'khichdi',BFP148:'dosa',BFP316:'raita'};
const ingredientEquivalents={L520:'curd',L500:'cheddar',T508:'ifct-T012',T506:'ifct-T013',T507:'ifct-T001',T509:'ifct-T004',T510:'ifct-T006',G536:'ifct-G029'};
const forbidden=/\b(egg|eggs|chicken|fish|mutton|beef|pork|prawn|prawns|shrimp|lamb|gelatin|gelatine|bacon|ham|salami|sausage|sausages|anchovy|anchovies|oyster|oysters|lard|suet)\b/i;
// These generic products do not establish an egg/gelatin/fish-free formulation.
const uncertain=new Set(['L507','X507','X509','X510','X500','I510','I511','W501','K502']);

export function loadINDB() {
  const cache=path.join(root,'.data/indb-source.json');
  let snapshot;
  try { snapshot=JSON.parse(fs.readFileSync(cache,'utf8')); }catch{ /* Extract below. */ }
  const expected=['Anuvaad_INDB_2024.11.xlsx',...['recipes.xlsx','UK_fct.xlsx','US_fct.xlsx'].map(n=>`Indian-Nutrient-Databank-INDB-/${n}`)];
  const stale=!snapshot||snapshot.formatVersion!==1||snapshot.extractorSha256!==createHash('sha256').update(fs.readFileSync(path.join(root,'scripts/extract-indb.py'))).digest('hex')||snapshot.files?.length!==expected.length||snapshot.files.some((f,i)=>f.path!==expected[i]||!fs.existsSync(path.join(root,f.path))||createHash('sha256').update(fs.readFileSync(path.join(root,f.path))).digest('hex')!==f.sha256);
  if(stale) {
    const result=spawnSync('python3',[path.join(root,'scripts/extract-indb.py')],{encoding:'utf8'});
    if(result.error||result.status!==0)throw new Error(`Cannot extract supplied INDB workbooks. Python 3 is required: ${result.error?.message||result.stderr}`);
    snapshot=JSON.parse(fs.readFileSync(cache,'utf8'));
  }
  return snapshot;
}

export function values(row,prefix='',recipe=false) {
  const result=Object.fromEntries(Object.keys(nutrients).map(k=>[k,null]));
  for(const [key,column] of Object.entries(fields)) {
    const raw=row[prefix+column];
    const value=raw==='Tr'&&['calories','protein','carbs','fat'].includes(key)?0:number(raw);
    // Upstream recipe calculations substitute unknowns with zero. Do not turn
    // these ambiguous micronutrient zeros into verified absence or coverage.
    result[key]=recipe&&!['calories','protein','carbs','fat','fiber'].includes(key)&&value===0?null:value;
  }
  const d2=number(row[prefix+'vitd2_ug']),d3=number(row[prefix+'vitd3_ug']);
  result.vitaminD=d2===null||d3===null||recipe&&d2+d3===0?null:d2+d3;
  const k1=number(row[prefix+'vitk1_ug']),k2=number(row[prefix+'vitk2_ug']);
  result.vitaminK=k1===null||k2===null||recipe&&k1+k2===0?null:k1+k2;
  // Total A/E do not establish the RAE / alpha-tocopherol definitions used here.
  // B12 is absent from the supplied workbooks.
  return result;
}

export function supplementINDB(primary,snapshot,allIFCT) {
  const foods=[...primary], byId=new Map(foods.map(f=>[f.id,f]));
  const names=new Map(primary.map(f=>[normalize(f.name),f.id]));
  const reference=new Map(allIFCT.map(f=>[f.code,f]));
  const sourceIngredients=new Map(snapshot.ingredients.map(r=>[r.food_code,r]));
  const recipeParts=new Map();
  for(const row of snapshot.recipeIngredients){const parts=recipeParts.get(row.recipe_code)||[];parts.push(row);recipeParts.set(row.recipe_code,parts);}
  const report={source:snapshot.source,sourceUrl:snapshot.sourceUrl,sourceRecipes:snapshot.recipes.length,addedRecipes:0,addedIngredients:0,primaryMatches:[],skipped:[],notes:[
    'Primary catalog records and nutrient values are never overwritten. Only missing foods and dishes are added.',
    'Recipes are screened using ingredient codes and names. Actual products, rennet and mess preparation require checking.',
    'Missing serving definitions use 100 g of the source recipe. Source ingredient quantities describe the original batch, not a serving.',
    'B12, vitamin A RAE and alpha-tocopherol are unknown in INDB additions. Ambiguous micronutrient zeros and incomplete ingredient subtotals remain unknown.',
    'Extreme serving values and oil-heavy recipe estimates are withheld for review.'
  ]};
  function ingredient(code,name) {
    if(!code||forbidden.test(name)||uncertain.has(code))return null;
    const main=reference.get(code);
    if(main&&!main.tags.split(/\s+/).includes('vegetarian'))return null;
    const existing=byId.get(`ifct-${code}`);
    if(existing)return existing;
    const row=sourceIngredients.get(code);
    if(!row||forbidden.test(row.food_name))return null;
    if(byId.has(ingredientEquivalents[code]))return byId.get(ingredientEquivalents[code]);
    const exact=names.get(normalize(row.food_name));
    if(exact)return byId.get(exact);
    const id=`indb-ingredient-${code}`;
    if(byId.has(id))return byId.get(id);
    const n=values(row);
    if(['calories','protein','carbs','fat'].some(k=>n[k]===null))return null;
    const dairy=/^L/.test(code)||['T500','T501','T506','X506','X508','I501'].includes(code);
    const food={id,name:row.food_name,aliases:row.food_code_org||'',source:`INDB ingredient reference · ${row.primarysource==='ukfct'?'UK CoFID':'USDA'}`,sourceUrl:snapshot.sourceUrl,sourceCode:code,
      group:'INDB ingredients',kind:'ingredient',serving:'100 g source ingredient',grams:100,dairy,ingredients:[],nutrients:n,
      traceFields:Object.entries(fields).filter(([,column])=>row[column]==='Tr').map(([key])=>key),
      basis:'Supplemental ingredient reference per 100 g. Trace macros are approximated as zero, not measured absence; unknown values stay unknown. Generic cheese requires vegetarian rennet. Source processing/fortification may differ from local products.'};
    foods.push(food);byId.set(id,food);names.set(normalize(food.name),id);report.addedIngredients++;
    return food;
  }
  // Add missing vegetarian ingredient references, even when no recipe needs them.
  for(const row of snapshot.ingredients)ingredient(row.food_code,row.food_name);
  for(const row of snapshot.recipes) {
    const code=row.food_code,name=row.food_name;
    const duplicate=byId.has(equivalents[code])?equivalents[code]:names.get(normalize(name));
    if(duplicate){report.primaryMatches.push({sourceCode:code,name,foodId:duplicate});continue;}
    const parts=recipeParts.get(code)||[];
    if(!parts.length){report.skipped.push({code,name,reason:'Missing ingredient list'});continue;}
    const mapped=parts.map(p=>({part:p,food:ingredient(p.food_code,p.food_name||p.ingredient_name_org)}));
    if(mapped.some(p=>!p.food)){report.skipped.push({code,name,reason:'Non-vegetarian, ambiguous or unresolved ingredient',ingredients:mapped.filter(p=>!p.food).map(p=>p.part.food_name||p.part.ingredient_name_org)});continue;}
    const per100=values(row,'',true),unit=values(row,'unit_serving_',true);
    const hasServing=Boolean(row.servings_unit)&&unit.calories!==null&&unit.calories>0;
    const n=hasServing?unit:per100;
    const fryingOil=mapped.some(({part:p})=>/oil|fat/i.test(p.food_name||'')&&['ml','g'].includes(p.unit)&&number(p.amount)>=200);
    if(['calories','protein','carbs','fat'].some(k=>n[k]===null)||per100.calories>900||per100.fat>100||hasServing&&(n.calories>1500||n.fat>100)||fryingOil&&per100.fat>40) {
      report.skipped.push({code,name,reason:'Questionable energy, fat, serving size or bulk frying-oil estimate'});continue;
    }
    for(const key of Object.keys(n))if(!['calories','protein','carbs','fat'].includes(key)) {
      if(mapped.some(({part,food})=>{
      const source=sourceIngredients.get(part.food_code);
        return (source?values(source)[key]:food.nutrients[key])===null;
      }))n[key]=null;
    }
    const food={id:`indb-${code}`,name,aliases:code,source:'INDB · calculated Indian recipe',sourceUrl:snapshot.sourceUrl,sourceCode:code,
      group:'INDB recipes',kind:'recipe',grams:hasServing?null:100,serving:hasServing?`1 ${row.servings_unit} · INDB reference`:'100 g prepared recipe · source serving unavailable',
      dairy:mapped.some(p=>p.food.dairy),nutrients:n,
      ingredients:mapped.map(({part:p,food:f})=>({foodId:f.id,grams:null,amount:number(p.amount),unit:p.unit||'',name:p.ingredient_name_org||p.food_name})),
      basis:'INDB calculated recipe estimate with source cooking-retention assumptions; actual mess recipes and yields vary. Ingredient quantities below are for the entire source batch, not this portion. B12 and compatible vitamin A/E measures are unknown.'};
    foods.push(food);byId.set(food.id,food);names.set(normalize(name),food.id);report.addedRecipes++;
  }
  return {foods:foods.slice(primary.length),report};
}
