import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { parse } from 'csv-parse/sync';
import { nutrients, macros } from './nutrition.js';
import { loadINDB, values as indbValues } from './indb.js';

export const messMenuSource = new URL('../nitk_mess_weekly_nutrients_all_estimated.csv', import.meta.url);
export const messFoodSource = new URL('../nitk_mess_96_foods_per_indian_serving.csv', import.meta.url);
const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const referenceAliases = { chapati: 'chapati', upma: 'upma', 'rice cooked': 'rice' };
const fields = {
  calories: 'energy_kcal', carbs: 'carbohydrate_g', protein: 'protein_g', fat: 'fat_g', fiber: 'fiber_g',
  calcium: 'calcium_mg', magnesium: 'magnesium_mg', potassium: 'potassium_mg', iron: 'iron_mg', zinc: 'zinc_mg',
  folate: 'vitamin_b9_folate_ug', vitaminC: 'vitamin_c_mg', b1: 'vitamin_b1_mg', b2: 'vitamin_b2_mg',
  vitaminA: 'vitamin_a_ug_rae', vitaminE: 'vitamin_e_mg', vitaminK: 'vitamin_k1_ug', b6: 'vitamin_b6_mg',
  vitaminD: 'vitamin_d_ug', b12: 'vitamin_b12_ug'
};
const extraFields = { sodium: ['sodium_mg', 'Sodium', 'mg'], phosphorus: ['phosphorus_mg', 'Phosphorus', 'mg'],
  b3: ['vitamin_b3_mg', 'Niacin · B3', 'mg'], freeSugar: ['free_sugar_g', 'Free sugar', 'g'],
  b5: ['vitamin_b5_mg', 'Pantothenic acid · B5', 'mg'] };
function value(row, column) {
  if (!column || row[column] === undefined || row[column].trim() === '') return null;
  const n = Number(row[column]);
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid NITK nutrient ${column}: ${row.menu_item}`);
  return n;
}

export function loadMessMenu(primary = []) {
  const matches = JSON.parse(fs.readFileSync(new URL('../data/nitk-dataset-matches.json', import.meta.url)));
  const indb = loadINDB();
  const sourceRecords = new Map([...indb.recipes, ...indb.ingredients].map(r => [r.food_code, r]));
  const recipeCodes = new Set(indb.recipes.map(r => r.food_code));
  const normalize = name => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const rows = parse(fs.readFileSync(messMenuSource), { bom: true, columns: true, skip_empty_lines: true });
  const foodRows = parse(fs.readFileSync(messFoodSource), { bom: true, columns: true, skip_empty_lines: true });
  const menu = days.map(() => ({ breakfast: [], lunch: [], dinner: [], snacks: [] }));
  const foods = new Map();
  const foodId = name => `nitk-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
  for (const row of foodRows) {
    const grams = value(row, 'edible_weight_g_per_unit');
    if (!row.menu_item || !row.serving_unit || !(grams > 0)) throw new Error('Invalid NITK food name or serving weight.');
    const id = foodId(row.menu_item);
    if (foods.has(id)) throw new Error(`Duplicate NITK food ID: ${id}`);
    const values = Object.fromEntries(Object.keys(nutrients).map(k => [k, value(row, fields[k])]));
    const sourceUrls = [...new Set((row.nutrient_source_urls || '').match(/https?:\/\/[^\s;|,]+/g) || [])];
    const portionSourceUrls = [...new Set((row.portion_source_urls || '').match(/https?:\/\/[^\s;|,]+/g) || [])];
    const referenceName = row.source_food_or_recipe;
    const reference = primary.find(f => sourceUrls.includes(f.sourceUrl))
      || primary.find(f => referenceName && normalize(f.name) === normalize(referenceName))
      || primary.find(f => f.id === referenceAliases[referenceName]);
    const dry = ['Oats', 'Cornflakes'].includes(row.menu_item);
    const food = {
      id, name: row.menu_item, aliases: `NITK mess ${referenceName}`, group: 'NITK mess menu', kind: 'mess-dish',
      serving: `${row.serving_unit} · ${grams} g${dry ? ' dry · before milk/water' : ''}`, grams, ingredients: reference?.ingredients || [],
      dairy: Boolean(reference?.dairy || /curd|paneer|butter|milk|kheer|lassi|custard|ice cream|jamun|makhani/i.test(`${row.menu_item}; ${referenceName}`)),
      nutrients: values, source: 'Uploaded NITK estimates per Indian serving',
      sourceUrl: sourceUrls[0] || null, sourceUrls, portionSourceUrls, dataStatus: row.nutrient_evidence, confidence: row.nutrient_evidence,
      basis: `Uploaded modeled estimate per ${row.serving_unit} (${grams} g${dry?' dry cereal':''}). ${row.data_quality_note} Vitamin K uses K1 only.`,
      menuCount: Number(row.menu_item.match(/\((\d+)\)/)?.[1]) || null,
      referenceFood: referenceName || null,
      portion: {
        unit: row.serving_unit, volumeMl: value(row, 'serving_volume_ml_if_applicable'),
        evidence: row.portion_evidence, rangeLowGrams: value(row, 'portion_size_range_g_low'),
        rangeHighGrams: value(row, 'portion_size_range_g_high'), explanation: row.portion_explanation
      },
      nutritionModel: {
        quality: row.nutrient_evidence, fortification: row.fortification_and_recipe_caution,
        cautions: row.data_quality_note
      },
      partialNutrients: ['vitaminK'],
      additionalNutrients: Object.fromEntries(Object.entries(extraFields).map(([k, [column, name, unit]]) => [k, { name, unit, value: value(row, column) }])),
      planningEligible: macros.every(k => values[k] !== null)
    };
    const match = matches[row.menu_item];
    if (match?.dataset === 'IFCT') {
      const selected = primary.find(f => f.id === `ifct-${match.code}`);
      if (!selected) throw new Error(`Missing IFCT menu reference: ${match.code}`);
      Object.assign(food, selected, { id, group: 'NITK mess menu', kind: 'mess-dish', aliases: `${row.menu_item} ${selected.aliases || ''}`, originalMenuName: row.menu_item, portion: null, menuCount: null, nutritionModel: null, partialNutrients: [] });
    } else if (match?.dataset === 'INDB') {
      const selected = sourceRecords.get(match.code);
      if (!selected) throw new Error(`Missing INDB menu reference: ${match.code}`);
      const isRecipe = recipeCodes.has(match.code);
      const prefix = isRecipe && selected.servings_unit && Number(selected.unit_serving_energy_kcal) > 0 ? 'unit_serving_' : '';
      const selectedValues = indbValues(selected, prefix, isRecipe);
      const number = key => { const raw = selected[prefix + key]; return raw !== undefined && raw !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0 ? Number(raw) : null; };
      const source = `INDB ${isRecipe ? 'recipe' : 'ingredient reference'} · ${match.code}`;
      Object.assign(food, { name: selected.food_name, aliases: `${row.menu_item} ${match.code}`, originalMenuName: row.menu_item, nutrients: selectedValues, source, sourceCode: match.code, sourceUrl: indb.sourceUrl, sourceUrls: [indb.sourceUrl], portionSourceUrls: [], referenceFood: selected.food_name,
        dairy: isRecipe ? indb.recipeIngredients.some(p => p.recipe_code === match.code && (/^L/.test(p.food_code || '') || /milk|curd|paneer|butter|cream|cheese|ghee|yogurt/i.test(p.food_name || p.ingredient_name_org || ''))) : /^L/.test(match.code) || /butter|cream|cheese|ghee|yogurt/i.test(selected.food_name),
        serving: prefix ? `1 ${selected.servings_unit} · INDB reference` : '100 g source food', grams: prefix ? null : 100,
        basis: `Direct reference to ${source}; ${prefix ? 'source serving' : 'per 100 g'}. Replaces ${row.menu_item}. Vitamin A RAE, compatible vitamin E and B12 are unavailable in this INDB schema.`,
        additionalNutrients: Object.fromEntries([['sodium','sodium_mg','Sodium','mg'],['phosphorus','phosphorus_mg','Phosphorus','mg'],['b3','vitb3_mg','Niacin · B3','mg'],['b5','vitb5_mg','Pantothenic acid · B5','mg'],['freeSugar','freesugar_g','Free sugar','g'],['vitaminAReported','vita_ug','INDB vitamin A · RAE equivalence unknown','µg']].map(([key,column,name,unit]) => [key,{name,unit,value:number(column),source}])),
        ingredients: primary.find(f => f.sourceCode === match.code)?.ingredients || [], portion: null, menuCount: null, nutritionModel: null, confidence: null, partialNutrients: [], dataStatus: 'dataset-reference' });
    }
    // Source records without native units use the uploaded household weight.
    // Keep their source names/values, scaling per-100 g data to that portion.
    if (match && food.grams === 100) {
      const scale = grams / 100;
      food.nutrients = Object.fromEntries(Object.entries(food.nutrients).map(([k,n]) => [k, n === null ? null : n * scale]));
      food.additionalNutrients = Object.fromEntries(Object.entries(food.additionalNutrients || {}).map(([k,n]) => [k, { ...n, value: n.value === null ? null : n.value * scale }]));
      food.grams = grams;
      food.serving = `${row.serving_unit} · ${grams} g source food`;
      food.basis += ` Per-100 g source values scaled to the uploaded ${grams} g portion.`;
    }
    if (match?.code === 'L520' && food.nutrients.b12 === null) {
      const curd = primary.find(f => f.id === 'curd');
      food.nutrients.b12 = curd.nutrients.b12 * food.grams / curd.grams;
      food.nutrientSources = { b12: { type: 'dataset', source: curd.source, sourceUrl: curd.sourceUrl } };
      food.basis += ' Missing B12 supplemented from the saved USDA whole-milk yogurt reference.';
    }
    food.planningEligible = macros.every(k => food.nutrients[k] !== null);
    foods.set(id, food);
  }
  for (const row of rows) {
    const day = days.indexOf(row.day), meal = row.meal.toLowerCase(), id = foodId(row.menu_item);
    if (day < 0 || !menu[day][meal] || !foods.has(id)) throw new Error(`NITK menu references an invalid day, meal or food: ${row.menu_item}`);
    if (!menu[day][meal].includes(id)) menu[day][meal].push(id);
  }
  const dates = rows.map(r => r.date).sort();
  const report = { source: 'NITK menu with selected INDB/IFCT dataset references; weekly CSV supplies scheduling only', rows: rows.length, dishes: foods.size,
    sourcePolicy:['First selected INDB candidate, or IFCT candidate when no INDB candidate exists','Uploaded values retained only when no candidate was selected'],
    primaryMatchedFoods:[...foods.values()].filter(f=>f.primaryReference).map(f=>({foodId:f.id,reference:f.primaryReference.foodId,fallbackNutrients:f.fallbackNutrients})),
    withNutrition: [...foods.values()].filter(f => f.planningEligible).length,
    withoutNutrition: [...foods.values()].filter(f => !f.planningEligible).length,
    knownByNutrient: Object.fromEntries(Object.keys(nutrients).map(k => [k, [...foods.values()].filter(f => f.nutrients[k] !== null).length])),
    sourceFrom: dates[0], sourceTo: dates.at(-1),
    sourceFiles: [messMenuSource, messFoodSource, new URL('../data/nitk-dataset-matches.json', import.meta.url)].map(url => ({ file: url.pathname.split('/').at(-1), sha256: createHash('sha256').update(fs.readFileSync(url)).digest('hex') })) };
  const preset = { id: 'nitk-uploaded', name: 'NITK · uploaded mess menu', example: false,
    sourceUrl: '/api/mess-menu/source', sourceTitle: 'User-supplied NITK weekly mess menu and nutrient references',
    reviewedAt: dates[0], status: `Uploaded menu dated ${dates[0]} to ${dates.at(-1)}, repeating by weekday.`,
    mappingNote: 'Foods use the first selected INDB/IFCT reference, including its name, nutrients and serving definition. Original IDs retain the weekly schedule. Five foods without selected candidates retain uploaded values. Actual mess preparation may differ.', menu };
  return { foods: [...foods.values()], preset, report };
}
