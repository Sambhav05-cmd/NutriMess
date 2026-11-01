import test from 'node:test';
import assert from 'node:assert/strict';
import { openStorage } from '../server/storage.js';

test('production refuses SQLite fallback and invalid MongoDB URIs do not leak credentials', async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(openStorage({ catalog: [], uri: '' }), /Set MONGODB_URI for production/);
    await assert.rejects(openStorage({ catalog: [], uri: 'not-a-uri:secret-password' }), error => !error.message.includes('secret-password'));
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});

test('local adapter rejects stale writes and rolls back duplicate accounts', async () => {
  const store = await openStorage({ catalog: [], uri: '', databasePath: ':memory:' });
  const student = { profile: { name: 'Original' }, completedMeals: [] };
  try {
    await store.createAccount({ id: 'one', email: 'one@example.com', salt: 'salt', password_hash: 'hash' }, student);
    const loaded = await store.getStudent('one');
    loaded.student.profile.name = 'Updated';
    await store.saveStudent('one', loaded.student, loaded.revision);
    await assert.rejects(store.saveStudent('one', student, loaded.revision), error => error.status === 409);
    assert.equal((await store.getStudent('one')).student.profile.name, 'Updated');
    await assert.rejects(store.createAccount({ id: 'two', email: 'one@example.com', salt: 'salt', password_hash: 'hash' }, student));
    assert.equal(await store.getStudent('two'), null);
  } finally { await store.close(); }
});
