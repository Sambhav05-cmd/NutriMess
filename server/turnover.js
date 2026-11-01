import fs from 'node:fs';

export const turnoverEvidence = JSON.parse(fs.readFileSync(new URL('../data/nutrient-turnover.json', import.meta.url), 'utf8'));
export function retentionFor(key) {
  const e = turnoverEvidence.nutrients[key];
  if (!e || e.mode !== 'turnover') return null;
  return e.lossFractionPerDay !== undefined ? 1 - e.lossFractionPerDay : 2 ** (-1 / e.halfLifeDays);
}
export function halfLifeFor(key) {
  const r = retentionFor(key);
  return r === null ? null : Math.log(.5) / Math.log(r);
}
export function intakeHistory(logs, foods, targets, through, baseline = null) {
  const throughMs = Date.parse(`${through}T12:00:00Z`);
  const daily = new Map();
  const unknown = {}, known = {};
  for (const log of logs) {
    const age = Math.round((throughMs - Date.parse(`${log.date}T12:00:00Z`)) / 86400000);
    if (age < 0) continue;
    const food = foods.get(log.foodId);
    if (!food) continue;
    if (!daily.has(log.date)) daily.set(log.date, { age, values: {} });
    const day = daily.get(log.date);
    for (const key of Object.keys(targets)) {
      const amount = food.nutrients[key];
      if (amount === null || amount === undefined) { unknown[key] = (unknown[key] || 0) + 1; continue; }
      known[key] = (known[key] || 0) + 1;
      day.values[key] = (day.values[key] || 0) + amount * log.portions;
    }
  }
  return Object.fromEntries(Object.keys(targets).map(key => {
    const r = retentionFor(key);
    let signal = 0, todayCoverage = 0;
    for (const day of daily.values()) {
      const coverage = Math.min(1, (day.values[key] || 0) / targets[key]);
      if (day.age === 0) todayCoverage = coverage;
      signal += coverage * (r === null ? (day.age === 0 ? 1 : 0) : r ** day.age);
    }
    const baselineAge = baseline ? Math.round((throughMs - Date.parse(`${baseline.date}T12:00:00Z`)) / 86400000) : -1;
    const startingCoverage = baselineAge >= 0 ? baseline.coverage * (r === null ? (baselineAge === 0 ? 1 : 0) : r ** baselineAge) : 0;
    return [key, { mode: r === null ? 'daily' : 'turnover', retainedTargetDays: signal,
      startingCoverage, historyCoverage: Math.min(1, startingCoverage + signal), assumedStart: Boolean(baseline),
      todayCoverage, retentionPerDay: r, halfLifeDays: halfLifeFor(key),
      knownEntries: known[key] || 0, unknownEntries: unknown[key] || 0,
      // Zero recorded contributions never establish an empty biological store.
      initialStores: 'unknown' }];
  }));
}
