import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function importIFCT() {
  const rows = parse(fs.readFileSync(path.join(root, 'ifct2017/compositions/index.csv')), { columns: true, skip_empty_lines: true });
  const foods = rows.filter(r => /\bvegetarian\b/.test(r.tags)).map(r => {
    const n = k => r[k] === '' || r[k] === undefined || !Number.isFinite(Number(r[k])) ? null : Number(r[k]);
    const unit = (key, factor) => n(key) === null ? null : n(key) * factor;
    return {
      id: `ifct-${r.code}`, name: r.name, group: r.grup, aliases: r.lang, source: 'IFCT 2017',
      basis: '100 g edible ingredient; usually raw', serving: '100 g edible ingredient', grams: 100,
      dairy: /milk|cheese|curd|paneer|butter|ghee|khoa/i.test(r.name), ingredients: [],
      additionalNutrients:{sodium:{name:'Sodium',unit:'mg',value:unit('na',1000)},phosphorus:{name:'Phosphorus',unit:'mg',value:unit('p',1000)},b3:{name:'Niacin · B3',unit:'mg',value:unit('nia',1000)},b5:{name:'Pantothenic acid · B5',unit:'mg',value:unit('pantac',1000)}},
      nutrients: { calories: unit('enerc', 1 / 4.184), protein: n('protcnt'), carbs: n('choavldf'), fat: n('fatce'), fiber: n('fibtg'),
        vitaminA: n('retol') === null || n('cartb') === null ? null : ((n('retol') || 0) + (n('cartb') || 0) / 12 + (n('carta') || 0) / 24 + (n('crypxb') || 0) / 24) * 1e6,
        vitaminC: unit('vitc', 1000), vitaminD: n('ergcal') === null || n('chocal') === null ? null : (n('ergcal') + n('chocal')) * 1e6,
        vitaminE: unit('tocpha', 1000), vitaminK: unit('vitk', 1e6), b1: unit('thia', 1000), b2: unit('ribf', 1000),
        b6: unit('vitb6c', 1000), b12: null, folate: unit('folsum', 1e6), calcium: unit('ca', 1000),
        iron: unit('fe', 1000), magnesium: unit('mg', 1000), zinc: unit('zn', 1000), potassium: unit('k', 1000) }
    };
  });
  const usdaDir = path.join(root, 'FoodData_Central_foundation_food_csv_2026-10-29');
  const missing = ['food.csv', 'food_nutrient.csv'].filter(f => !fs.existsSync(path.join(usdaDir, f)));
  const result = { foods, report: { importedAt: new Date().toISOString(), ifctFoods: foods.length,
    usda: { imported: false, missing, message: missing.length ? 'Incomplete USDA export: food identity and nutrient joins are unavailable. No USDA nutrient values imported.' : 'USDA files detected; a verified vegetarian classification and nutrient mapping are required before import.' },
    notes: ['Nutrient values are per 100 g edible ingredient. Source mass values converted from grams to mg/µg.', 'Vitamin A uses retinol + beta-carotene/12 + alpha-carotene/24 + beta-cryptoxanthin/24 (RAE).', 'B12 is not reported in IFCT. Unknown values remain null and never count as verified coverage.', 'Recipe values are estimates from raw ingredient weights; cooking losses and actual mess recipes vary.'] } };
  return result;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) console.log(JSON.stringify(importIFCT().report,null,2));
