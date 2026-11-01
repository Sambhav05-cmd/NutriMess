import { DatabaseSync } from 'node:sqlite';
import { createStudentCodec, studentFoodKeys } from './student-store.js';

export function readSqliteSnapshot(filename) {
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec('BEGIN');
    const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
    if (!tables.has('students')) throw new Error('The source is not a NutriMess SQLite database.');
    const dictionary = tables.has('food_ids') ? db.prepare('SELECT id, food_key FROM food_ids').all() : [];
    const codec = createStudentCodec(dictionary);
    const students = db.prepare('SELECT id, document FROM students').all().map(r => ({ id: r.id, student: codec.decode(JSON.parse(r.document)) }));
    const accounts = tables.has('accounts') ? db.prepare('SELECT id, email, salt, password_hash FROM accounts').all().map(r => ({ ...r })) : [];
    const studentIds = new Set(students.map(r => r.id));
    if (accounts.some(a => !studentIds.has(a.id))) throw new Error('An account is missing its student document; repair the source before migration.');
    const sessions = tables.has('sessions') ? db.prepare('SELECT token_hash, student_id, expires FROM sessions WHERE expires > ?').all(Date.now()).filter(r => studentIds.has(r.student_id)).map(r => ({ ...r })) : [];
    db.exec('COMMIT');
    return { students, accounts, sessions };
  } finally { db.close(); }
}

export async function importSqliteSnapshot(storage, snapshot) {
  if (storage.kind !== 'mongodb') throw new Error('The migration target must be MongoDB.');
  await storage.ensureFoodKeys(snapshot.students.flatMap(r => studentFoodKeys(r.student)));
  const session = storage.client.startSession();
  try {
    return await session.withTransaction(async () => {
      const documents = {
        students: snapshot.students.map(r => ({ _id: r.id, revision: 0, document: storage.encodeStudent(r.student) })),
        accounts: snapshot.accounts.map(({ id, ...account }) => ({ _id: id, ...account })),
        sessions: snapshot.sessions.map(r => ({ _id: r.token_hash, student_id: r.student_id, expires: new Date(r.expires) }))
      };
      const report = {};
      for (const [collection, records] of Object.entries(documents)) {
        // Never replace a target record. A conflicting unique email aborts the
        // transaction, preserving both source data and existing Atlas records.
        const result = records.length ? await storage.db.collection(collection).bulkWrite(records.map(record => ({ updateOne: { filter: { _id: record._id }, update: { $setOnInsert: record }, upsert: true } })), { session, ordered: true }) : { upsertedCount: 0 };
        report[collection] = { inserted: result.upsertedCount, alreadyPresent: records.length - result.upsertedCount };
      }
      return report;
    });
  } finally { await session.endSession(); }
}
