import fs from 'node:fs';
import path from 'node:path';
import { createStudentStore } from './student-store.js';

export function storageConflict() {
  const error = new Error('Your data changed in another request. Reload and try again.');
  error.status = 409;
  return error;
}

export async function openStorage({ catalog, uri = process.env.MONGODB_URI, databaseName = process.env.MONGODB_DB || 'nutrimess', databasePath = process.env.DB_PATH || new URL('../.data/nutrimess.sqlite', import.meta.url).pathname } = {}) {
  if (uri) {
    if (!/^mongodb(?:\+srv)?:\/\//.test(uri)) throw new Error('MONGODB_URI must be a MongoDB connection string.');
    const { openMongoStorage } = await import('./mongo-store.js');
    return openMongoStorage({ catalog, uri, databaseName });
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Set MONGODB_URI for production. SQLite fallback is available only for local development.');
  const { DatabaseSync } = await import('node:sqlite');
  if (databasePath !== ':memory:') fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new DatabaseSync(databasePath);
  db.exec('PRAGMA journal_mode = WAL;');
  const { read, write } = createStudentStore(db, catalog);
  if (!db.prepare('PRAGMA table_info(students)').all().some(c => c.name === 'revision')) db.exec('ALTER TABLE students ADD COLUMN revision INTEGER NOT NULL DEFAULT 0');
  db.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, salt TEXT NOT NULL, password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, student_id TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS college_menus (id TEXT PRIMARY KEY, document TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS reference_documents (id TEXT PRIMARY KEY, document TEXT NOT NULL);`);
  return {
    kind: 'sqlite',
    async getStudent(id) {
      const row = db.prepare('SELECT revision FROM students WHERE id = ?').get(id);
      return row ? { student: read.get(id), revision: row.revision } : null;
    },
    async saveStudent(id, student, revision) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (db.prepare('SELECT revision FROM students WHERE id = ?').get(id)?.revision !== revision) throw storageConflict();
        write.run(id, student);
        db.prepare('UPDATE students SET revision = revision + 1 WHERE id = ?').run(id);
        db.exec('COMMIT');
        return revision + 1;
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async findAccount(email) { return db.prepare('SELECT * FROM accounts WHERE email = ?').get(email); },
    async getAccount(id) { return db.prepare('SELECT * FROM accounts WHERE id = ?').get(id); },
    async createAccount(account, student, legacyRevision) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (legacyRevision !== undefined && db.prepare('SELECT revision FROM students WHERE id = ?').get(account.id)?.revision !== legacyRevision) throw storageConflict();
        db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(account.id, account.email, account.salt, account.password_hash);
        write.run(account.id, student);
        db.prepare('UPDATE students SET revision = ? WHERE id = ?').run(legacyRevision === undefined ? 0 : legacyRevision + 1, account.id);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    async createSession(tokenHash, studentId, expires) {
      db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
      db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(tokenHash, studentId, expires.getTime());
    },
    async findSession(tokenHash) { return db.prepare('SELECT student_id FROM sessions WHERE token_hash = ? AND expires > ?').get(tokenHash, Date.now()); },
    async deleteSession(tokenHash) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash); },
    async seedDocuments(table, records) {
      if (!['college_menus', 'reference_documents'].includes(table)) throw new Error('Invalid reference collection');
      const statement = db.prepare(`INSERT INTO ${table} VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document`);
      for (const record of records) statement.run(record.id, JSON.stringify(record.document));
    },
    async listColleges() { return db.prepare('SELECT document FROM college_menus ORDER BY id').all().map(r => JSON.parse(r.document)); },
    async referenceLibrary() { return JSON.parse(db.prepare('SELECT document FROM reference_documents WHERE id = ?').get('library').document); },
    async ping() { db.prepare('SELECT 1').get(); },
    async close() { db.close(); }
  };
}
