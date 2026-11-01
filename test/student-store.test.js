import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createStudentStore, mealNames } from '../server/student-store.js';

const catalog = [{ id: 'rice' }, { id: 'milk' }];
function fixture() {
  const entries = mealNames.map((meal, i) => ({ id: `log-${i}`, date: '2026-11-01', meal, foodId: 'rice', portions: 1.5 }));
  return {
    profile: { name: 'Student', preferred: ['rice'], excluded: ['milk'] },
    menu: [{ breakfast: ['milk'], lunch: ['rice'], dinner: [], snacks: [] }],
    attendance: [{ breakfast: true, lunch: false, dinner: true, snacks: true }],
    logs: entries, extras: [{ date: '2026-11-02', meal: 'snacks', foodId: 'milk' }],
    strategies: [{ id: 'strategy', name: 'Weekly', days: [{ entries }] }],
    activations: [{ from: '2026-11-01', name: 'Snapshot', days: [{ entries }] }],
    colleges: [{ id: 'custom', menu: [{ breakfast: ['rice'] }] }],
    plan: { days: [{ entries }], noData: ['vitaminD'] },
    completedMeals: mealNames.map(meal => ({ date: '2026-11-01', meal }))
  };
}

test('compact storage round-trips food references, every meal, fractions, and completion bits', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createStudentStore(db, catalog), student = fixture();
    const before = structuredClone(student);
    store.write.run('student', student);
    const stored = JSON.parse(db.prepare('SELECT document FROM students').get().document);
    assert.equal(typeof stored.logs[0].foodId, 'number');
    assert.deepEqual(stored.logs.map(log => log.meal), [0, 1, 2, 3]);
    assert.equal(stored.logs[0].portions, 1.5);
    assert.deepEqual(stored.completedMealMasks, { '2026-11-01': 15 });
    assert.equal(stored.completedMeals, undefined);
    assert.equal(stored.menu[0].lunch[0], stored.logs[0].foodId);
    assert.equal(stored.strategies[0].days[0].entries[0].foodId, stored.logs[0].foodId);
    assert.deepEqual(store.read.get('student'), student);
    assert.deepEqual(student, before);
    assert.equal(store.read.get('missing'), undefined);
    assert.ok(JSON.stringify(stored).length < JSON.stringify(student).length);
    const reopened = createStudentStore(db, [...catalog].reverse().concat({ id: 'banana' }));
    assert.deepEqual(reopened.read.get('student'), student);
    assert.equal(JSON.parse(db.prepare('SELECT document FROM students').get().document).logs[0].foodId, stored.logs[0].foodId);
  } finally { db.close(); }
});

test('legacy migration preserves retired foods and is idempotent', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE students (id TEXT PRIMARY KEY, document TEXT NOT NULL)');
    const legacy = fixture();
    legacy.logs[0].foodId = 'retired-food';
    legacy.completedMeals = [{ date: '2026-11-01', meal: 'lunch' }, { date: '2026-11-02', meal: 'dinner' }];
    db.prepare('INSERT INTO students VALUES (?, ?)').run('legacy', JSON.stringify(legacy));
    const first = createStudentStore(db, catalog);
    assert.deepEqual(first.read.get('legacy'), legacy);
    const persisted = db.prepare('SELECT document FROM students').get().document;
    assert.deepEqual(JSON.parse(persisted).completedMealMasks, { '2026-11-01': 2, '2026-11-02': 4 });
    const second = createStudentStore(db, catalog.slice(1));
    assert.deepEqual(second.read.get('legacy'), legacy);
    second.write.run('legacy', second.read.get('legacy'));
    assert.equal(db.prepare('SELECT document FROM students').get().document, persisted);
  } finally { db.close(); }
});

test('migration failure rolls back all student changes and dictionary inserts', () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('CREATE TABLE students (id TEXT PRIMARY KEY, document TEXT NOT NULL)');
    const valid = JSON.stringify(fixture()), invalid = fixture();
    invalid.logs[0].meal = 'invalid';
    const insert = db.prepare('INSERT INTO students VALUES (?, ?)');
    insert.run('valid', valid); insert.run('invalid', JSON.stringify(invalid));
    assert.throws(() => createStudentStore(db, catalog), /Unknown meal/);
    assert.equal(db.prepare('SELECT document FROM students WHERE id = ?').get('valid').document, valid);
    assert.equal(db.prepare('SELECT count(*) AS n FROM food_ids').get().n, 0);
  } finally { db.close(); }
});

test('unsupported versions and invalid references fail without overwriting data', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const store = createStudentStore(db, catalog);
    store.write.run('student', fixture());
    const original = db.prepare('SELECT document FROM students').get().document;
    const invalid = fixture(); invalid.logs[0].foodId = 'unknown';
    assert.throws(() => store.write.run('student', invalid), /Unknown stored food ID/);
    assert.equal(db.prepare('SELECT document FROM students').get().document, original);
    const future = JSON.stringify({ storageVersion: 2 });
    db.prepare('UPDATE students SET document = ?').run(future);
    assert.throws(() => createStudentStore(db, catalog), /Unsupported student storage version/);
    assert.equal(db.prepare('SELECT document FROM students').get().document, future);
  } finally { db.close(); }
});
