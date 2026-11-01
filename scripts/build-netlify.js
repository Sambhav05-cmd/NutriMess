import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const raw = process.env.NUTRIMESS_API_ORIGIN;
let backend;
try {
  backend = new URL(raw);
  if (backend.protocol !== 'https:' || backend.username || backend.password || backend.search || backend.hash || backend.pathname !== '/') throw new Error();
} catch {
  throw new Error('Set NUTRIMESS_API_ORIGIN to your persistent Express backend HTTPS origin, for example https://your-backend.onrender.com. Netlify static hosting cannot run the SQLite API.');
}
const frontend = process.env.URL;
if (frontend && new URL(frontend).origin === backend.origin) throw new Error('The backend origin must differ from the Netlify frontend to avoid a proxy loop.');
const output = path.join(root, 'dist/netlify');
fs.mkdirSync(output, { recursive: true });
fs.cpSync(path.join(root, 'public'), output, { recursive: true });
fs.writeFileSync(path.join(output, '_redirects'), `/api/*  ${backend.origin}/api/:splat  200!\n`);
fs.writeFileSync(path.join(output, '_headers'), '/api/*\n  Cache-Control: no-store\n');
console.log(`Netlify frontend ready: ${output}\nAPI proxy: ${backend.origin}/api/*`);
