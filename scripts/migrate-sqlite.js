import { parseArgs } from 'node:util';
import { readSqliteSnapshot, importSqliteSnapshot } from '../server/sqlite-import.js';
import { openStorage } from '../server/storage.js';

const { values, positionals } = parseArgs({ options: { apply: { type: 'boolean', default: false }, help: { type: 'boolean', default: false } }, allowPositionals: true });
if (values.help || positionals.length !== 1) {
  console.log('Usage: npm run migrate:sqlite -- /path/to/nutrimess.sqlite [--apply]\nWithout --apply, only inspect the read-only SQLite source.\nFor --apply, set MONGODB_URI and optionally MONGODB_DB. Existing MongoDB records are never overwritten.');
  process.exit(values.help ? 0 : 1);
}
let storage;
try {
  const snapshot = readSqliteSnapshot(positionals[0]);
  console.log(JSON.stringify({ sourceRecords: { students: snapshot.students.length, accounts: snapshot.accounts.length, unexpiredSessions: snapshot.sessions.length }, mode: values.apply ? 'import' : 'preview' }, null, 2));
  if (values.apply) {
    if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI before using --apply.');
    storage = await openStorage({ catalog: [] });
    console.log(JSON.stringify(await importSqliteSnapshot(storage, snapshot), null, 2));
  } else console.log('Source was opened read-only. Add --apply to import into Atlas.');
} catch (error) {
  console.error(error.code === 11000 ? 'Migration aborted: an existing Atlas account has a conflicting email. No imported account/student/session changes were committed.' : `Migration failed (${error.name}). Check the source database, Atlas access and environment settings. The SQLite source was not modified.`);
  process.exitCode = 1;
} finally { await storage?.close(); }
