import { importIFCT } from '../scripts/import-data.js';
import { nutrients, portionStep } from './nutrition.js';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { loadINDB, supplementINDB } from './indb.js';
import { loadMessMenu } from './mess-menu.js';

const imported = importIFCT();
fs.mkdirSync(new URL('../.data/',import.meta.url),{recursive:true});
export const catalog = imported.foods;
export const dataReport = imported.report;
const byId = new Map(catalog.map(f => [f.id, f]));
const dairySnapshot = JSON.parse(fs.readFileSync(new URL('../data/usda-dairy-source.json', import.meta.url), 'utf8'));
const nutrientIds = { calories: 1008, protein: 1003, carbs: 1005, fat: 1004, fiber: 1079, vitaminA: 1106, vitaminC: 1162, vitaminD: 1114, vitaminE: 1109, vitaminK: 1185, b1: 1165, b2: 1166, b6: 1175, b12: 1178, folate: 1187, calcium: 1087, iron: 1089, magnesium: 1090, zinc: 1095, potassium: 1092 };
const expectedUnits = { calories: 'kcal', protein: 'g', carbs: 'g', fat: 'g', fiber: 'g', vitaminA: 'µg', vitaminC: 'mg', vitaminD: 'µg', vitaminE: 'mg', vitaminK: 'µg', b1: 'mg', b2: 'mg', b6: 'mg', b12: 'µg', folate: 'µg', calcium: 'mg', iron: 'mg', magnesium: 'mg', zinc: 'mg', potassium: 'mg' };
for (const spec of [
  { fdcId: 171284, id: 'curd', name: 'Plain curd / whole-milk yogurt', serving: '1 bowl · 150 g', grams: 150, emoji: '🥣' },
  { fdcId: 173414, id: 'cheddar', name: 'Cheddar cheese · vegetarian rennet only', serving: '1 slice · 25 g', grams: 25, emoji: '🧀' }
]) {
  const record = dairySnapshot.records.find(r => r.fdcId === spec.fdcId);
  if (!record) throw new Error(`Missing saved USDA dairy record ${spec.fdcId}`);
  const values = Object.fromEntries(Object.entries(nutrientIds).map(([key, id]) => {
    const row = record.foodNutrients.find(n => n.nutrient.id === id);
    if (row && row.nutrient.unitName.toLowerCase().replace('ug', 'µg') !== expectedUnits[key]) throw new Error(`Unexpected USDA unit: ${key}`);
    return [key, Number.isFinite(row?.amount) ? row.amount * spec.grams / 100 : null];
  }));
  const f = { ...spec, group: 'Dairy', aliases: spec.id === 'curd' ? 'dahi yoghurt yogurt curd' : 'cheese cheddar', dairy: true, ingredients: [], nutrients: values,
    additionalNutrients:Object.fromEntries([['sodium',1093,'Sodium'],['phosphorus',1091,'Phosphorus'],['b3',1167,'Niacin · B3'],['b5',1170,'Pantothenic acid · B5']].map(([key,id,name])=>{
      const row=record.foodNutrients.find(n=>n.nutrient.id===id);
      if(row&&row.nutrient.unitName.toLowerCase()!=='mg')throw new Error(`Unexpected USDA unit for ${key}`);
      return [key,{name,unit:'mg',value:Number.isFinite(row?.amount)?row.amount*spec.grams/100:null}];
    })),
    source: `USDA SR Legacy · FDC ${spec.fdcId}`, sourceUrl: `https://fdc.nal.usda.gov/fdc-app.html#/food-details/${spec.fdcId}/nutrients`,
    basis: spec.id === 'curd' ? 'USDA plain whole-milk yogurt used as a curd reference; actual Indian dahi varies.' : 'Generic USDA cheddar nutrient reference. Choose cheese labeled suitable for vegetarians; the USDA record does not verify rennet.' };
  catalog.push(f); byId.set(f.id, f);
}
dataReport.supplementalDairy = { source: 'Official USDA FoodData Central API, saved offline snapshot', retrievedAt: dairySnapshot.retrievedAt, foods: dairySnapshot.records.map(r => ({ fdcId: r.fdcId, name: r.description })), note: 'Separate verified dairy records; the supplied incomplete USDA export remains unimported.' };
const milkReference = JSON.parse(fs.readFileSync(new URL('../data/usda-milk-source.json', import.meta.url)));
const milkB12 = milkReference.foodNutrients.find(n => n.nutrient.id === 1178);
if (milkB12?.nutrient.unitName !== 'µg' || !Number.isFinite(milkB12.amount)) throw new Error('Invalid USDA milk B12 reference');
const cowMilk = byId.get('ifct-L002');
cowMilk.nutrients.b12 = milkB12.amount;
cowMilk.nutrientSources = { b12: { type: 'dataset', source: `USDA SR Legacy · FDC ${milkReference.fdcId} · whole-milk B12 reference`, sourceUrl: `https://fdc.nal.usda.gov/food-details/${milkReference.fdcId}/nutrients` } };
cowMilk.basis += ' Missing B12 supplemented from the saved USDA unfortified whole-milk reference.';
function recipe(id, name, serving, ingredients, emoji, group = 'Mess recipes') {
  const parts = ingredients.map(([code, grams]) => ({ food: byId.get(code.startsWith('ifct-') || byId.has(code) ? code : `ifct-${code}`), grams }));
  if (parts.some(p => !p.food)) throw new Error(`Missing ingredient in ${id}`);
  const values = Object.fromEntries(Object.keys(nutrients).map(k => [k, parts.some(p => p.food.nutrients[k] === null) ? null : parts.reduce((s, p) => s + p.food.nutrients[k] * p.grams / (p.food.grams || 100), 0)]));
  const food = { id, name, serving, grams: null, group, emoji, source: parts.some(p => /USDA/.test(p.food.source)) ? 'Recipe estimate · USDA / IFCT references' : 'Recipe estimate · IFCT 2017', basis: 'Ingredient weights per prepared serving; water contributes no nutrients; cooking retention not modeled.',
    dairy: parts.some(p => p.food.dairy), ingredients: parts.map(p => ({ foodId: p.food.id, grams: p.grams })), nutrients: values };
  catalog.push(food); byId.set(id, food);
}
recipe('poha', 'Vegetable poha', '1 bowl', [['A011',55],['G017',20],['F002',30],['T005',5]], '🥣');
recipe('upma', 'Vegetable upma', '1 bowl', [['A022',60],['G017',20],['F002',35],['T005',5]], '🥣');
recipe('idli', 'Idli', '3 medium idlis', [['A015',45],['B010',18]], '🍚');
recipe('dosa', 'Plain dosa', '1 medium dosa', [['A015',45],['B010',15],['T005',5]], '🥞');
recipe('chapati', 'Whole wheat roti', '2 medium rotis', [['A019',60]], '🫓');
recipe('rice', 'Steamed rice', '1 bowl · ~180 g cooked', [['A015',60]], '🍚');
recipe('dal', 'Moong dal tadka', '1 bowl', [['B010',45],['D075',35],['G017',15],['T005',4]], '🍲');
recipe('masoor', 'Masoor dal', '1 bowl', [['B013',45],['D075',35],['G017',15],['T005',4]], '🍲');
recipe('chana', 'Chana masala', '1 bowl', [['B002',55],['D075',40],['G017',25],['T005',5]], '🫘');
recipe('palak', 'Palak paneer', '1 bowl', [['C033',100],['L003',70],['D075',30],['T005',4]], '🥬');
recipe('paneer', 'Paneer bhurji', '1 bowl', [['L003',90],['D075',40],['G017',25],['T005',4]], '🧀');
recipe('sabzi', 'Aloo & carrot sabzi', '1 bowl', [['F006',100],['F002',70],['T005',5]], '🥕');
recipe('spinach', 'Spinach stir fry', '1 bowl', [['C033',130],['G017',20],['T005',4]], '🥬');
recipe('khichdi', 'Moong dal khichdi', '1 bowl', [['A015',40],['B010',35],['F002',40],['T005',4]], '🍲');
recipe('salad', 'Carrot & tomato salad', '1 plate', [['F002',80],['D075',80]], '🥗');
recipe('milk', 'Whole cow milk', '1 glass · 250 g', [['L002',250]], '🥛', 'Dairy');
recipe('buffalo-milk', 'Whole buffalo milk', '1 glass · 250 g', [['L001',250]], '🥛', 'Dairy');
recipe('plain-paneer', 'Plain paneer', '1 portion · 100 g', [['L003',100]], '🧀', 'Dairy');
recipe('khoa', 'Unsweetened khoa / khoya', '1 portion · 40 g', [['L004',40]], '🥛', 'Dairy');
recipe('ghee', 'Ghee', '1 teaspoon · 5 g', [['T013',5]], '🧈', 'Dairy');
recipe('buttermilk', 'Plain chaas / buttermilk', '1 glass · 250 g (75 g curd + water)', [['curd',75]], '🥛', 'Dairy');
recipe('lassi', 'Unsweetened plain lassi', '1 glass (150 g curd + water)', [['curd',150]], '🥛', 'Dairy');
recipe('raita', 'Carrot raita', '1 bowl (100 g curd + 30 g carrot)', [['curd',100],['F002',30]], '🥣', 'Dairy');
recipe('banana', 'Banana', '1 medium · 100 g edible', [['E012',100]], '🍌', 'Everyday extras');
recipe('guava', 'Guava', '1 fruit · 100 g edible', [['E028',100]], '🍈', 'Everyday extras');
recipe('orange', 'Orange', '1 fruit · 130 g edible', [['E047',130]], '🍊', 'Everyday extras');
recipe('almonds', 'Almonds', '1 small handful · 20 g', [['H001',20]], '🥜', 'Everyday extras');
const indb=supplementINDB(catalog,loadINDB(),parse(fs.readFileSync(new URL('../ifct2017/compositions/index.csv',import.meta.url)),{columns:true,skip_empty_lines:true}));
for(const f of indb.foods){catalog.push(f);byId.set(f.id,f);}
dataReport.indb=indb.report;
const messMenu=loadMessMenu(catalog);
for(const f of messMenu.foods){
  if(byId.has(f.id))throw new Error(`Duplicate catalog food ID: ${f.id}`);
  catalog.push(f);byId.set(f.id,f);
}
export const messMenuPreset=messMenu.preset;
dataReport.messMenu=messMenu.report;
dataReport.sourcePriority={primary:'Supplied IFCT dataset and saved official USDA records',fallback:'Uploaded recipe CSVs and INDB Excel for foods/nutrients without a compatible primary match',matching:'Prepared form and weight must match; raw grains are not substituted for cooked dishes',usdaExport:imported.report.usda.message};
fs.writeFileSync(new URL('../.data/indb-import-report.json',import.meta.url),JSON.stringify(indb.report,null,2)+'\n');
for (const food of catalog) food.portionStep = portionStep(food);
if(new Set(catalog.map(f=>f.id)).size!==catalog.length)throw new Error('Duplicate food IDs in shared catalog');
export const catalogVersion=createHash('sha256').update(JSON.stringify(catalog)).digest('hex');
dataReport.catalogVersion=catalogVersion;
const catalogSnapshot=new URL(`../.data/catalog-${process.pid}.tmp`,import.meta.url);
fs.writeFileSync(catalogSnapshot,JSON.stringify({version:catalogVersion,foods:catalog,report:dataReport}));
fs.renameSync(catalogSnapshot,new URL('../.data/catalog.json',import.meta.url));
export const foods = byId;
export const slots = ['breakfast', 'lunch', 'dinner', 'snacks'];
const breakfast = [['poha','milk','banana'],['idli','dal','milk'],['upma','milk','guava'],['dosa','dal','banana']];
export function sampleMenu(offset = 0) {
  return Array.from({ length: 7 }, (_, i) => ({ breakfast: breakfast[(i + offset) % 4],
    lunch: ['chapati', 'rice', i % 2 ? 'chana' : 'dal', i % 3 ? 'sabzi' : 'palak', 'salad', 'curd'],
    dinner: ['chapati', i % 2 ? 'khichdi' : 'rice', i % 2 ? 'masoor' : 'chana', i % 3 ? 'spinach' : 'paneer'],
    snacks: ['banana', 'guava', 'milk', 'almonds', 'buttermilk'] }));
}
export const collegePresets = [
  { id: 'campus-north', name: 'Campus North · sample hostel', example: true, menu: sampleMenu() },
  { id: 'campus-south', name: 'Campus South · sample hostel', example: true, menu: sampleMenu(2) }
];
