import { MongoClient } from 'mongodb';
import { createStudentCodec } from './student-store.js';
import { storageConflict } from './storage.js';
import { cancelInitialPlans } from './initial-plan.js';

export async function openMongoStorage({ uri, databaseName, catalog = [] }) {
  const client = new MongoClient(uri, { maxPoolSize: 10, minPoolSize: 0, serverSelectionTimeoutMS: 15000, connectTimeoutMS: 10000, retryWrites: true });
  try {
    await client.connect();
    const db = client.db(databaseName);
    const students = db.collection('students'), accounts = db.collection('accounts'), sessions = db.collection('sessions');
    const dictionary = db.collection('food_ids'), counters = db.collection('counters');
    await accounts.createIndex({ email: 1 }, { unique: true });
    await sessions.createIndex({ expires: 1 }, { expireAfterSeconds: 0 });
    await dictionary.createIndex({ food_key: 1 }, { unique: true });
    let codec;
    async function reloadCodec() {
      const rows = await dictionary.find({}).toArray();
      codec = createStudentCodec(rows.map(r => ({ id: r._id, food_key: r.food_key })));
      return rows;
    }
    async function ensureFoodKeys(keys) {
      const existing = await reloadCodec();
      const known = new Set(existing.map(r => r.food_key));
      const missing = [...new Set(keys)].filter(key => !known.has(key));
      if (missing.length) {
        await counters.updateOne({ _id: 'food_ids' }, { $max: { value: Math.max(0, ...existing.map(r => r._id)) } }, { upsert: true });
        const counter = await counters.findOneAndUpdate({ _id: 'food_ids' }, { $inc: { value: missing.length } }, { returnDocument: 'after' });
        const first = counter.value - missing.length + 1;
        try {
          await dictionary.insertMany(missing.map((food_key, i) => ({ _id: first + i, food_key })), { ordered: false });
        } catch (error) {
          // Concurrent starts may insert the same food key. IDs are never reused.
          if (!error.writeErrors?.length || error.writeErrors.some(e => e.code !== 11000)) throw error;
        }
        await reloadCodec();
      }
    }
    await ensureFoodKeys(catalog.map(f => f.id));
    const storage = {
      kind: 'mongodb', client, db, ensureFoodKeys,
      encodeStudent(student) { return codec.encode(student); },
      async getStudent(id) {
        const row = await students.findOne({ _id: id });
        if (!row) return null;
        let student;
        try { student = codec.decode(row.document); }
        catch (error) {
          if (!error.message.startsWith('Unknown stored food ID:')) throw error;
          await reloadCodec();
          student = codec.decode(row.document);
        }
        return { student, revision: row.revision };
      },
      async saveStudent(id, student, revision) {
        const result = await students.replaceOne({ _id: id, revision }, { _id: id, revision: revision + 1, document: codec.encode(student) });
        if (result.matchedCount !== 1) throw storageConflict();
        return revision + 1;
      },
      async findAccount(email) { const row = await accounts.findOne({ email }); return row && { ...row, id: row._id }; },
      async getAccount(id) { const row = await accounts.findOne({ _id: id }); return row && { ...row, id: row._id }; },
      async createAccount(account, student, legacyRevision) {
        const session = client.startSession();
        try {
          await session.withTransaction(async () => {
            const { id, ...credentials } = account;
            await accounts.insertOne({ _id: id, ...credentials }, { session });
            const row = { _id: id, revision: legacyRevision === undefined ? 0 : legacyRevision + 1, document: codec.encode(student) };
            if (legacyRevision === undefined) await students.insertOne(row, { session });
            else if ((await students.replaceOne({ _id: id, revision: legacyRevision }, row, { session })).matchedCount !== 1) throw storageConflict();
          });
        } finally { await session.endSession(); }
      },
      async createSession(tokenHash, studentId, expires) { await sessions.insertOne({ _id: tokenHash, student_id: studentId, expires }); },
      async findSession(tokenHash) { return sessions.findOne({ _id: tokenHash, expires: { $gt: new Date() } }); },
      async deleteSession(tokenHash) { await sessions.deleteOne({ _id: tokenHash }); },
      async seedDocuments(collection, records) {
        if (!['college_menus', 'reference_documents'].includes(collection)) throw new Error('Invalid reference collection');
        if (records.length) await db.collection(collection).bulkWrite(records.map(r => ({ replaceOne: { filter: { _id: r.id }, replacement: { _id: r.id, document: r.document }, upsert: true } })));
      },
      async listColleges() { return (await db.collection('college_menus').find({}).sort({ _id: 1 }).toArray()).map(r => r.document); },
      async referenceLibrary() { return (await db.collection('reference_documents').findOne({ _id: 'library' })).document; },
      async ping() { await db.command({ ping: 1 }); },
      async close() { await cancelInitialPlans(storage); await client.close(); }
    };
    return storage;
  } catch (error) {
    await client.close();
    // Never echo a connection string or credentials into deployment logs.
    throw new Error(`MongoDB startup failed (${error.codeName || error.name}). Check Atlas credentials, network access and MONGODB_URI.`);
  }
}
