# Deploy NutriMess

The frontend can be hosted on Netlify. The Express API needs Node 24+, Python 3 for the INDB extractor, and persistent storage for SQLite. A static Netlify upload alone cannot provide accounts, meal logs or the planner API.

## Backend

Use an existing Node server, or create a Render Blueprint from this repository using `render.yaml`. The Render configuration uses a paid Starter web service and a 1 GB persistent disk; review the costs before creating it. Render's native build environment must provide Python 3. Build with `npm ci --omit=dev && npm run import:data` and start with `npm start`.

Set `PUBLIC_ORIGIN` to the exact frontend origin, such as `https://your-site.netlify.app`. Set `TRUST_PROXY=1` when running behind Render's trusted reverse proxy. Keep `DB_PATH` on the persistent disk. The backend health endpoint is `/api/health`.

For another hosting provider, use the same build/start commands and environment variables, with a persistent `DB_PATH` appropriate to that host. Only one backend process should write this SQLite database.

## Netlify Git deployment

1. Import the GitHub repository in Netlify.
2. Set the build environment variable `NUTRIMESS_API_ORIGIN` to the backend HTTPS origin, for example `https://your-backend.onrender.com`. Do not include `/api` or a trailing path.
3. Keep the configured build command `npm run build:netlify` and publish directory `dist/netlify`.
4. Set the backend's `PUBLIC_ORIGIN` to the final Netlify URL, then deploy/restart the backend.

The generated `_redirects` proxies `/api/*` through Netlify. The browser uses the same frontend origin for assets and API calls, including session cookies. Requests from an unconfigured frontend origin are rejected by the backend.

## Manual Netlify upload

With the backend running, generate the upload folder:

```sh
NUTRIMESS_API_ORIGIN=https://your-backend.onrender.com npm run build:netlify
```

Upload **the `dist/netlify` folder**, including `_redirects` and `_headers`, using Netlify Drop. Set `PUBLIC_ORIGIN` on the backend to the resulting frontend URL. Never upload the repository root, `.data`, credentials, or source workbooks as public website files.

The build fails clearly if the backend origin has not been supplied. No backend URL or hosting account is created by committing this configuration.

## Local development

`npm start` still serves both the frontend and API at `http://127.0.0.1:3000` without Netlify. Local `.data` records are ignored by Git and are not migrated to a hosted backend automatically.
