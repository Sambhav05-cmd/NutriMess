// Storage-only encoding: the API and nutrition engine retain readable IDs.
export const mealNames = Object.freeze(['breakfast', 'lunch', 'dinner', 'snacks']);
const version = 1;
const foodArrayKeys = new Set(['preferred', 'excluded', ...mealNames]);

function transform(value, food, meal, key = '') {
  if (key === 'foodId') return food(value);
  if (key === 'meal') return meal(value);
  if (Array.isArray(value)) {
    if (foodArrayKeys.has(key)) return value.map(food);
    return value.map(item => transform(item, food, meal));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, transform(v, food, meal, k)]));
  }
  return value;
}

export function createStudentCodec(dictionary) {
  const toNumber = new Map(dictionary.map(r => [r.food_key, r.id]));
  const toKey = new Map(dictionary.map(r => [r.id, r.food_key]));
  function lookup(map, value, label) {
    if (!map.has(value)) throw new Error(`Unknown stored ${label}: ${value}`);
    return map.get(value);
  }
  function mealNumber(value) {
    const id = mealNames.indexOf(value);
    if (id < 0) throw new Error(`Unknown meal: ${value}`);
    return id;
  }
  function encode(student) {
    const { completedMeals = [], ...rest } = student;
    const stored = transform(rest, value => lookup(toNumber, value, 'food ID'), mealNumber);
    stored.completedMealMasks = {};
    for (const { date, meal } of completedMeals) {
      stored.completedMealMasks[date] = (stored.completedMealMasks[date] || 0) | (1 << mealNumber(meal));
    }
    stored.storageVersion = version;
    return stored;
  }
  function decode(stored) {
    if (stored.storageVersion === undefined) return stored;
    if (stored.storageVersion !== version) throw new Error(`Unsupported student storage version: ${stored.storageVersion}`);
    const { completedMealMasks = {}, storageVersion, ...rest } = stored;
    const student = transform(rest, value => lookup(toKey, value, 'food ID'), value => {
      if (!Number.isInteger(value) || !mealNames[value]) throw new Error(`Unknown stored meal: ${value}`);
      return mealNames[value];
    });
    student.completedMeals = [];
    for (const [date, mask] of Object.entries(completedMealMasks)) {
      if (!Number.isInteger(mask) || mask < 0 || mask > 15) throw new Error(`Invalid completion mask: ${mask}`);
      mealNames.forEach((meal, id) => {
        if (mask & (1 << id)) student.completedMeals.push({ date, meal });
      });
    }
    return student;
  }
  return { encode, decode };
}

export function studentFoodKeys(student) {
  const keys = new Set();
  transform(student, key => { keys.add(key); return key; }, meal => meal);
  return [...keys];
}

export function createStudentStore(db, catalog) {
  db.exec(`CREATE TABLE IF NOT EXISTS students (id TEXT PRIMARY KEY, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS food_ids (id INTEGER PRIMARY KEY AUTOINCREMENT, food_key TEXT UNIQUE NOT NULL);`);
  const get = db.prepare('SELECT document FROM students WHERE id = ?');
  const put = db.prepare('INSERT INTO students (id, document) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document');
  const insertFood = db.prepare('INSERT INTO food_ids (food_key) VALUES (?) ON CONFLICT(food_key) DO NOTHING');
  let codec;
  const loadDictionary = () => { codec = createStudentCodec(db.prepare('SELECT id, food_key FROM food_ids').all()); };
  const encode = student => codec.encode(student);
  const decode = stored => codec.decode(stored);

  // Seed and migrate together. Keep retired food keys as well as current ones;
  // IDs are never derived from catalog order and are never reused.
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const food of catalog) insertFood.run(food.id);
    const rows = db.prepare('SELECT id, document FROM students').all();
    for (const row of rows) {
      const student = JSON.parse(row.document);
      if (student.storageVersion === undefined) transform(student, key => {
        insertFood.run(key);
        return key;
      }, meal => meal);
    }
    loadDictionary();
    for (const row of rows) {
      const stored = JSON.parse(row.document);
      if (stored.storageVersion === undefined) put.run(row.id, JSON.stringify(encode(stored)));
      else decode(stored); // Refuse an incompatible database before serving requests.
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return {
    read: { get(id) {
      const row = get.get(id);
      return row ? decode(JSON.parse(row.document)) : undefined;
    } },
    write: { run(id, student) {
      return put.run(id, JSON.stringify(encode(student)));
    } }
  };
}
