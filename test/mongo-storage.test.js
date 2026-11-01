import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, scryptSync, createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { catalog } from '../server/catalog.js';
import { newStudent } from '../server/accounts.js';
import { openStorage } from '../server/storage.js';
import { createStudentStore } from '../server/student-store.js';
import { readSqliteSnapshot, importSqliteSnapshot } from '../server/sqlite-import.js';
import { dateKey } from '../server/nutrition.js';

// Always use a disposable, uniquely named database. Never use MONGODB_URI here.
const uri = process.env.MONGODB_TEST_URI;
const dbName = () => `nutrimess_test_${randomUUID().replaceAll('-', '')}`;
const credentials = (id, email) => ({ id, email, salt: 'migration-salt', password_hash: scryptSync('p', 'migration-salt', 64).toString('hex') });

test('MongoDB storage preserves compact records, transactions, sessions, revisions and migration', { skip: !uri }, async t => {
  const databaseName = dbName();
  const [store, peer] = await Promise.all([openStorage({ catalog, uri, databaseName }), openStorage({ catalog: [...catalog].reverse(), uri, databaseName })]);
  try {
    const student = newStudent();
    student.logs = [{ id: 'log', date: dateKey(), meal: 'lunch', foodId: 'curd', portions: .5 }];
    student.completedMeals = [{ date: dateKey(), meal: 'dinner' }];
    student.strategies = [{ id: 'strategy', name: 'Saved', revision: 1, days: Array.from({ length: 7 }, () => ({ entries: [{ foodId: 'milk', meal: 'breakfast', portions: 1 }] })) }];

    await t.test('round-trip, numeric food IDs, completion masks and stale-save rejection', async () => {
      await store.createAccount(credentials('one', 'one@example.com'), student);
      const record = await store.getStudent('one');
      assert.deepEqual(record.student, student);
      const raw = await store.db.collection('students').findOne({ _id: 'one' });
      assert.equal(raw.document.storageVersion, 1);
      assert.equal(typeof raw.document.logs[0].foodId, 'number');
      assert.equal(raw.document.logs[0].meal, 1);
      assert.equal(raw.document.completedMealMasks[dateKey()], 4);
      record.student.profile.name = 'Saved revision';
      assert.equal(await store.saveStudent('one', record.student, record.revision), 1);
      await assert.rejects(peer.saveStudent('one', student, 0), error => error.status === 409);
      assert.equal((await peer.getStudent('one')).student.profile.name, 'Saved revision');
    });

    await t.test('duplicate account creation rolls back the student write', async () => {
      await assert.rejects(store.createAccount(credentials('duplicate', 'one@example.com'), student), error => error.code === 11000);
      assert.equal(await store.getStudent('duplicate'), null);
      assert.equal(await store.getAccount('duplicate'), null);
    });

    await t.test('claiming an unclaimed student preserves data and advances its revision', async () => {
      const id = randomUUID();
      await store.db.collection('students').insertOne({ _id: id, revision: 0, document: store.encodeStudent(student) });
      await store.createAccount(credentials(id, 'claimed@example.com'), student, 0);
      assert.deepEqual((await store.getStudent(id)).student, student);
      assert.equal((await store.getStudent(id)).revision, 1);
    });

    await t.test('sessions persist across connections, expire and revoke', async () => {
      await store.createSession('active-hash', 'one', new Date(Date.now() + 60000));
      assert.equal((await peer.findSession('active-hash')).student_id, 'one');
      await store.createSession('expired-hash', 'one', new Date(Date.now() - 1000));
      assert.equal(await store.findSession('expired-hash'), null);
      const indexes = await store.db.collection('sessions').indexes();
      assert.ok(indexes.some(i => i.key.expires === 1 && i.expireAfterSeconds === 0));
      await peer.deleteSession('active-hash');
      assert.equal(await store.findSession('active-hash'), null);
    });

    await t.test('SQLite import is read-only, preserves credentials and retired foods, and is idempotent', async () => {
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'nutrimess-migration-'));
      const filename = path.join(directory, 'source.sqlite');
      try {
        const db = new DatabaseSync(filename);
        db.exec('CREATE TABLE students (id TEXT PRIMARY KEY, document TEXT NOT NULL); CREATE TABLE accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE, salt TEXT, password_hash TEXT); CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, student_id TEXT, expires INTEGER)');
        const legacy = structuredClone(student);
        legacy.logs[0].foodId = 'retired-food';
        db.prepare('INSERT INTO students VALUES (?, ?)').run('migrated', JSON.stringify(legacy));
        createStudentStore(db, catalog);
        db.prepare('INSERT INTO students (id, document) VALUES (?, ?)').run('unclaimed-legacy-json', JSON.stringify(legacy));
        const account = credentials('migrated', 'migrated@example.com');
        db.prepare('INSERT INTO accounts VALUES (?, ?, ?, ?)').run(account.id, account.email, account.salt, account.password_hash);
        db.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run('migrated-token-hash', account.id, Date.now() + 60000);
        db.close();
        const before = createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
        const snapshot = readSqliteSnapshot(filename);
        assert.equal(createHash('sha256').update(fs.readFileSync(filename)).digest('hex'), before);
        assert.deepEqual(snapshot.students[0].student, legacy);
        const imported = await importSqliteSnapshot(store, snapshot);
        assert.equal(imported.students.inserted, 2);
        assert.deepEqual((await store.getStudent('migrated')).student, legacy);
        assert.deepEqual((await store.getStudent('unclaimed-legacy-json')).student, legacy);
        assert.deepEqual((await peer.getStudent('migrated')).student, legacy, 'a running peer reloads new retired food IDs');
        assert.equal((await store.findAccount(account.email)).password_hash, account.password_hash);
        assert.equal((await store.findSession('migrated-token-hash')).student_id, 'migrated');
        const second = await importSqliteSnapshot(store, snapshot);
        assert.equal(second.students.inserted, 0);
        assert.equal(second.accounts.alreadyPresent, 1);
        const conflict = structuredClone(snapshot);
        conflict.students[0].id = 'conflicting-id';
        conflict.accounts[0].id = 'conflicting-id';
        conflict.sessions = [];
        await assert.rejects(importSqliteSnapshot(store, conflict), error => error.code === 11000);
        assert.equal(await store.getStudent('conflicting-id'), null);
      } finally { fs.rmSync(directory, { recursive: true, force: true }); }
    });
  } finally { await peer.close(); await store.db.dropDatabase(); await store.close(); }
});

test('MongoDB HTTP flows await writes and persist accounts, strategies, logs and sessions across app instances', { skip: !uri }, async () => {
  const databaseName = dbName();
  process.env.MONGODB_URI = uri;
  process.env.MONGODB_DB = databaseName;
  let first, second;
  const servers = [];
  async function listen(app) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    servers.push(server);
    return `http://127.0.0.1:${server.address().port}/api/`;
  }
  let cookie = '', base;
  async function request(route, method = 'GET', body) {
    const res = await fetch(base + route, { method, headers: { cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (res.headers.get('set-cookie')) cookie = res.headers.get('set-cookie').split(';')[0];
    return { status: res.status, data: await res.json() };
  }
  try {
    first = await import(`../server/index.js?mongo=${databaseName}`);
    base = await listen(first.app);
    assert.equal((await request('health')).status, 200);
    const registered = await request('auth/register', 'POST', { email: 'mongo@example.com', password: 'p', name: 'Mongo student', gender: 'male', collegeId: 'nitk-uploaded' });
    assert.equal(registered.status, 200);
    assert.equal(registered.data.initialPlan.status, 'pending');
    const deadline = Date.now() + 30000;
    let prepared = registered;
    while (prepared.data.initialPlan.status === 'pending') {
      assert.ok(Date.now() < deadline, 'Background plan did not finish');
      await new Promise(resolve => setTimeout(resolve, 50));
      prepared = await request('state');
    }
    assert.equal(prepared.data.initialPlan.status, 'ready');
    const originalCookie = cookie;
    const duplicate = await request('auth/register', 'POST', { email: 'mongo@example.com', password: 'p', name: 'Duplicate', gender: 'male', collegeId: 'custom' });
    assert.equal(duplicate.status, 409);
    assert.equal((await request('logs', 'POST', { date: dateKey(), meal: 'lunch', foodId: 'curd', portions: .5 })).status, 200);
    const days = Array.from({ length: 7 }, () => ({ entries: [{ foodId: 'milk', meal: 'breakfast', portions: 1 }] }));
    const saved = await request('strategies', 'POST', { name: 'Mongo strategy', days });
    assert.equal(saved.status, 201);
    const strategy = saved.data.strategies[0];
    assert.equal((await request(`strategies/${strategy.id}/activate`, 'POST', {})).status, 200);
    second = await import(`../server/index.js?mongo=reopened_${databaseName}`);
    base = await listen(second.app);
    const restored = await request('state');
    assert.equal(restored.status, 200);
    assert.equal(restored.data.logs[0].foodId, 'curd');
    assert.equal(restored.data.strategies[0].name, 'Mongo strategy');
    assert.ok(restored.data.activations.some(a => a.strategyId === strategy.id));
    assert.equal((await request('catalog')).data.colleges.some(c => c.id === 'nitk-uploaded'), true);
    assert.equal((await request('auth/logout', 'POST', {})).status, 200);
    cookie = originalCookie;
    assert.equal((await request('state')).status, 401);
    assert.equal((await request('auth/login', 'POST', { email: 'mongo@example.com', password: 'wrong' })).status, 401);
    assert.equal((await request('auth/login', 'POST', { email: 'mongo@example.com', password: 'p' })).status, 200);
    assert.notEqual(cookie, originalCookie);
  } finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    await second?.storage.close();
    if (first) { await first.storage.db.dropDatabase(); await first.storage.close(); }
    delete process.env.MONGODB_URI;
    delete process.env.MONGODB_DB;
  }
});
