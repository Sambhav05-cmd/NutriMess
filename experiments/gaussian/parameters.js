// Prototype optimization preferences, not measured health risks.
// Variances are dimensionless; standard deviation = sqrt(variance).
export const variances = Object.freeze({
  // 1% normalized SD: 5% calorie excess gives exp(-12.5), about 0.00000373.
  calories: .0001, protein: .09, carbs: .09, fat: .09, fiber: .09,
  vitaminA: .09, b1: .04, b2: .09, b3: .09, b5: .16,
  b6: .09, b7: .16, folate: .04, b12: .04, vitaminC: .09,
  vitaminD: .04, vitaminE: .16, vitaminK: .09,
  calcium: .04, phosphorus: .09, magnesium: .09, iron: .04,
  zinc: .04, iodine: .04, selenium: .09, copper: .09,
  manganese: .16, chromium: .16, molybdenum: .16, potassium: .09
});

export function gaussianPenalty(actual, target, key) {
  if (!Number.isFinite(actual) || actual < 0) throw new Error(`Invalid intake: ${key}`);
  if (!Number.isFinite(target) || target <= 0) throw new Error(`Invalid target: ${key}`);
  const variance = variances[key];
  if (!(variance > 0)) throw new Error(`No experimental variance: ${key}`);
  const gap = key === 'calories' ? Math.max(0, actual / target - 1) : Math.max(0, 1 - actual / target);
  return gap ** 2 / (2 * variance);
}
