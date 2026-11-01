import { portionStep } from './nutrition.js';

export const defaultPlanningRules = () => ({ minimums: { roti: 2, dosa: 1, paratha: 1, idli: 2 }, requireGroups: true, groupMinimumA: 1, groupMinimumB: 1, overrides: [] });
export function planningRulesFor(profile) {
  const defaults = defaultPlanningRules(), saved = profile?.planningRules || {};
  return { ...defaults, ...saved, minimums: { ...defaults.minimums, ...saved.minimums }, overrides: saved.overrides || [] };
}
export function planningGroup(food, rules) {
  return rules.overrides.find(row => row.foodId === food.id)?.group || food.planningGroup || 'C';
}
export function stapleType(food) {
  const name = food.originalMenuName || food.name || '';
  if (/\b(parathas?|paranthas?)\b/i.test(name)) return 'paratha';
  if (/\b(rotis?|chapatis?)\b/i.test(name)) return 'roti';
  if (/\bdosas?\b/i.test(name)) return 'dosa';
  if (/\bidlis?\b/i.test(name)) return 'idli';
  return null;
}
export function minimumPortions(food, rules) {
  if (planningGroup(food, rules) === 'C') return 0;
  const type = stapleType(food);
  if (!type) return 0;
  // Source servings can contain multiple pieces (e.g. "2 medium rotis").
  const pieces = Number(food.serving?.match(/^\s*(\d+(?:\.\d+)?)\b/)?.[1]) || 1;
  const step = portionStep(food);
  return Math.ceil((rules.minimums[type] / pieces) / step - 1e-9) * step;
}
export function mealRuleIssues(entries, available, foods, rules) {
  const issues = [];
  for (const id of available) {
    const food = foods.get(id), minimum = minimumPortions(food, rules);
    const amount = entries.filter(e => e.foodId === id).reduce((sum, e) => sum + e.portions, 0);
    if (amount + 1e-9 < minimum) issues.push(`${food.originalMenuName || food.name}: minimum ${minimum} listed serving(s).`);
  }
  if (rules.requireGroups && available.some(id => planningGroup(foods.get(id), rules) !== 'C')) {
    for (const group of ['A', 'B']) {
      const minimum = rules[`groupMinimum${group}`];
      if (!minimum) continue;
      if (!available.some(id => planningGroup(foods.get(id), rules) === group)) issues.push(`No group ${group} dish is available for this meal.`);
      else if (!entries.some(e => planningGroup(foods.get(e.foodId), rules) === group && e.portions >= minimum)) issues.push(`Choose at least ${minimum} serving(s) of one group ${group} dish.`);
    }
  }
  return issues;
}
