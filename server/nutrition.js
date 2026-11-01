export const nutrients = {
  calories: { name: 'Energy', unit: 'kcal' }, protein: { name: 'Protein', unit: 'g' },
  carbs: { name: 'Carbohydrates', unit: 'g' }, fat: { name: 'Fat', unit: 'g' }, fiber: { name: 'Fiber', unit: 'g' },
  vitaminA: { name: 'Vitamin A', unit: 'µg RAE' }, vitaminC: { name: 'Vitamin C', unit: 'mg' },
  vitaminD: { name: 'Vitamin D', unit: 'µg' }, vitaminE: { name: 'Vitamin E', unit: 'mg' },
  vitaminK: { name: 'Vitamin K', unit: 'µg' }, b1: { name: 'Thiamin · B1', unit: 'mg' },
  b2: { name: 'Riboflavin · B2', unit: 'mg' }, b6: { name: 'Vitamin B6', unit: 'mg' },
  b12: { name: 'Vitamin B12', unit: 'µg' }, folate: { name: 'Food folate', unit: 'µg' },
  calcium: { name: 'Calcium', unit: 'mg' }, iron: { name: 'Iron', unit: 'mg' },
  magnesium: { name: 'Magnesium', unit: 'mg' }, zinc: { name: 'Zinc', unit: 'mg' }, potassium: { name: 'Potassium', unit: 'mg' }
};
export const macros = ['calories', 'protein', 'carbs', 'fat'];
export const micros = Object.keys(nutrients).filter(k => !macros.includes(k));
export function portionStep(food) {
  return /\b(bowl|katori)\b/i.test(food?.serving || '') ? .25 : 1;
}
export const zero = () => Object.fromEntries(Object.keys(nutrients).map(k => [k, 0]));
export function add(a, b, factor = 1) {
  const result = { ...a };
  for (const k of Object.keys(nutrients)) result[k] = (a[k] || 0) + (b[k] || 0) * factor;
  return result;
}
export function normalizeGender(value) {
  const key=typeof value==='string'?value.trim().toLowerCase():'';
  return ['female','woman'].includes(key)?'female':['male','man'].includes(key)?'male':null;
}
export function migrateProfileGender(profile) {
  profile.gender=normalizeGender(profile.gender)||normalizeGender(profile.sex)||'male';
  delete profile.sex;
  return profile;
}
export function targets(p) {
  const female = (normalizeGender(p.gender)||normalizeGender(p.sex)) === 'female';
  const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (female ? -161 : 5);
  const calories = Math.round(bmr * ({ sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725 }[p.activity]));
  const protein = Math.round(p.weight * (p.activity === 'active' ? 1.6 : 1.2));
  const fat = Math.round(calories * .28 / 9);
  return { calories, protein, carbs: Math.round((calories - protein * 4 - fat * 9) / 4), fat,
    fiber: female ? 25 : 38, vitaminA: female ? 700 : 900, vitaminC: female ? 75 : 90,
    vitaminD: 15, vitaminE: 15, vitaminK: female ? 90 : 120,
    b1: female ? 1.1 : 1.2, b2: female ? 1.1 : 1.3, b6: 1.3, b12: 2.4, folate: 400,
    calcium: 1000, iron: female ? 18 : 8, magnesium: female ? 310 : 400, zinc: female ? 8 : 11, potassium: female ? 2600 : 3400 };
}
// Food-only limits where a general adult total-intake UL exists. Other ULs may
// apply to supplements/fortification only, so are not imposed on food folate etc.
export const upperLimits = { vitaminC: 2000, vitaminD: 100, calcium: 2500, iron: 45, zinc: 40 };
export function dateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function shiftDate(date, days) {
  const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
export function monday(date = dateKey()) {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay(); return shiftDate(date, -(day + 6) % 7);
}
export function totals(entries, foods) {
  return entries.reduce((sum, e) => add(sum, foods.get(e.foodId)?.nutrients, e.portions), zero());
}
