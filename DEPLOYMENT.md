# Deploy NutriMess on Render Free + MongoDB Atlas Free

Render serves the website and Express API together. Atlas persists accounts, sessions, profiles, menus, saved strategies and meal logs. Nutrition source files remain in Git. A new Atlas-backed deployment needs no persistent Render disk.

## Create Atlas

1. Create an Atlas Free cluster near your Render service's region.
2. In Database Access, create an application user with readWrite access to the `nutrimess` database. Use a strong, unique password.
3. In Network Access, allow the outbound IP ranges shown on your Render service's Connect → Outbound panel. Add your laptop's public IP separately if you will run a local import.
4. Open Connect → Drivers → Node.js and copy the `mongodb+srv://...` connection string. Replace username/password placeholders and URL-encode special characters in credentials.
5. Save the real URI only in Render environment settings or a local ignored `.env`. Do not put it in GitHub or frontend code.

Atlas Free has storage and throughput limits. Render Free sleeps after inactivity, so the first visit can be slow. Atlas user data remains separate from Render's disposable filesystem.

## Deploy Render

Connect the `master` branch using the existing `render.yaml` Blueprint, or create a Node web service manually:

| Setting | Value |
|---|---|
| Root directory | Leave blank |
| Plan | Free |
| Build command | `npm ci --omit=dev && npm run import:data` |
| Start command | `npm start` |
| Health check | `/api/health` |

| Environment variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `NODE_VERSION` | `24.11.0` |
| `HOST` | `0.0.0.0` |
| `TRUST_PROXY` | `1` |
| `MONGODB_URI` | Your secret Atlas driver connection string |
| `MONGODB_DB` | `nutrimess` |

Render supplies `PORT`. Leave `DB_PATH` unset. `PUBLIC_ORIGIN` is unnecessary when frontend and API share the Render URL. Production refuses to start without `MONGODB_URI` instead of silently writing user data to ephemeral SQLite storage.

The build/start environment needs Node 24+ and Python 3 for the existing INDB extractor, which uses only Python's standard library. Check `https://YOUR-SERVICE.onrender.com/api/health` returns `{"ok":true}`, then open the base URL and create an account.

If connection fails, check the Atlas database user's credentials/role, percent-encoding in the URI, cluster state and the outbound IP allowlist. Startup errors do not echo the connection string.

## Import existing SQLite data

Skip this for a fresh hosted database. Keep any existing SQLite disk until the import and account checks are complete.

The importer supports original JSON and compact storage version 1. It preserves password hashes, account IDs, profiles, menus, logs, saved strategies, activation history, completed meals, retired food references and unexpired sessions. Food references are re-encoded using Atlas's persistent dictionary. Shared reference menus/documents are seeded from Git at startup.

Preview the source without changing it or connecting to Atlas:

```sh
npm run migrate:sqlite -- /path/to/nutrimess.sqlite
```

Put `MONGODB_URI` and `MONGODB_DB` in an ignored local `.env`, then import:

```sh
node --env-file=.env scripts/migrate-sqlite.js /path/to/nutrimess.sqlite --apply
```

The source opens read-only. Existing Atlas records are never replaced; repeated imports skip existing IDs. A conflicting account email aborts the account/student/session transaction. Dictionary entries created while preparing an aborted import may remain; they do not replace user data.

For a live SQLite deployment, pause new writes for the final transfer. Run the import where the database and any WAL files are available, or use SQLite's online backup API to create a consistent source copy. Verify existing account login, logs, strategies and history on Atlas before switching production, detaching the old disk and selecting Render Free. Keep a SQLite backup.

## Local development and verification

Without `MONGODB_URI`, non-production runs retain SQLite and `DB_PATH` support. To use Atlas locally:

```sh
node --env-file=.env server/index.js
```

Both adapters retain compact student encoding. Atlas uses document revisions to reject stale updates with HTTP 409, a unique email index, hashed session tokens, expiration checks on every request and a TTL index for cleanup.

MongoDB integration checks require a dedicated replica set because account creation and import use transactions:

```sh
MONGODB_TEST_URI='mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true' npm run test:mongo
node --test test/student-store.test.js test/strategies.test.js
```

The MongoDB tests use a unique disposable database name, never fall back to `MONGODB_URI`, and clean up their own test databases. Do not point tests at a production database server.

## Optional Netlify frontend

The Netlify build remains available. Set `NUTRIMESS_API_ORIGIN` in Netlify to the Render HTTPS origin, build with `npm run build:netlify`, and publish `dist/netlify`. Set Render's `PUBLIC_ORIGIN` to the exact Netlify frontend origin. For manual upload, build locally with that environment variable and upload `dist/netlify`, including `_redirects` and `_headers`. Never publish the repository root, credentials, databases or workbooks as website files.
