import fs from 'node:fs';
import { collegePresets, messMenuPreset } from './catalog.js';
export function seedColleges(db) {
  db.exec('CREATE TABLE IF NOT EXISTS college_menus (id TEXT PRIMARY KEY, document TEXT NOT NULL)');
  const records=JSON.parse(fs.readFileSync(new URL('../data/college-menus.json',import.meta.url),'utf8'));
  const insert=db.prepare('INSERT INTO college_menus VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document');
  for(const c of [...records,...collegePresets,messMenuPreset])insert.run(c.id,JSON.stringify(c));
  db.exec('CREATE TABLE IF NOT EXISTS reference_documents (id TEXT PRIMARY KEY, document TEXT NOT NULL)');
  const save=db.prepare('INSERT INTO reference_documents VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET document=excluded.document');
  for(const [id,file] of [['library','reference-library.json'],['turnover','nutrient-turnover.json'],['dairy','usda-dairy-source.json']])save.run(id,fs.readFileSync(new URL(`../data/${file}`,import.meta.url),'utf8'));
}
export function listColleges(db) { return db.prepare('SELECT document FROM college_menus ORDER BY id').all().map(r=>JSON.parse(r.document)); }
export function referenceLibrary(db) { return JSON.parse(db.prepare('SELECT document FROM reference_documents WHERE id = ?').get('library').document); }
