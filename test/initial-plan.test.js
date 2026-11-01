import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { installAccounts, newStudent } from '../server/accounts.js';
import { catalog, catalogVersion } from '../server/catalog.js';
import { openStorage } from '../server/storage.js';
import { ensureInitialPlan } from '../server/initial-plan.js';

test('signup and login finish while initial optimization has not run', async () => {
  const storage = await openStorage({ catalog, uri: '', databasePath: ':memory:' });
  const app = express();
  app.use(express.json());
  let scheduled;
  installAccounts(app, storage, { response: async req => req.student, startInitialPlan: (_, id) => { scheduled = id; } });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/api/auth/`;
  const credentials = { email: 'signup@example.com', password: 'test-password', name: 'Student', gender: 'male', collegeId: 'custom' };
  const post = (route, body) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(5000) });
  try {
    const registered = await post('register', credentials);
    assert.equal(registered.status, 200);
    assert.match(registered.headers.get('set-cookie'), /HttpOnly/);
    const student = await registered.json();
    assert.equal(student.initialPlan.status, 'pending');
    assert.equal(student.plan, null);
    assert.equal(student.activations.length, 0);
    assert.equal((await storage.findAccount(credentials.email)).id, scheduled);
    assert.equal((await post('login', credentials)).status, 200);
    assert.equal((await post('login', { ...credentials, password: 'wrong' })).status, 401);
    assert.equal((await post('register', credentials)).status, 409);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await storage.close();
  }
});

test('background planning persists a usable plan and preserves newer choices', { timeout: 60000 }, async () => {
  const storage = await openStorage({ catalog, uri: '', databasePath: ':memory:' });
  const create = async id => {
    const student = newStudent();
    // A small real menu keeps this focused on scheduling and persistence.
    student.menu = Array.from({ length: 7 }, () => ({ breakfast: ['milk'], lunch: ['curd'], snacks: [], dinner: ['milk'] }));
    student.initialPlan = { status: 'pending', jobId: randomUUID() };
    await storage.createAccount({ id, email: `${id}@example.com`, salt: 'salt', password_hash: 'unused' }, student);
  };
  const finished = async id => {
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      const record = await storage.getStudent(id);
      if (record.student.initialPlan.status !== 'pending') return record.student;
      await delay(50);
    }
    assert.fail('Initial plan did not finish');
  };
  try {
    await create('ready');
    ensureInitialPlan(storage, 'ready');
    ensureInitialPlan(storage, 'ready'); // Duplicate requests share one job.
    const ready = await finished('ready');
    assert.equal(ready.initialPlan.status, 'ready');
    assert.equal(ready.plan.catalogVersion, catalogVersion);
    assert.equal(ready.plan.days.length, 7);
    assert.deepEqual(ready.activations[0].days, ready.plan.days.map(day => ({ entries: day.entries })));
    await create('changed');
    ensureInitialPlan(storage, 'changed');
    const current = await storage.getStudent('changed');
    current.student.activations = [{ from: '2026-01-01', name: 'My chosen strategy', days: [] }];
    await storage.saveStudent('changed', current.student, current.revision);
    const changed = await finished('changed');
    assert.equal(changed.initialPlan.status, 'superseded');
    assert.equal(changed.activations[0].name, 'My chosen strategy');
    assert.equal(changed.plan, null);
  } finally { await storage.close(); }
});
