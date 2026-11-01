import fs from 'node:fs';
import { collegePresets, messMenuPreset } from './catalog.js';
export async function seedColleges(storage) {
  const records=JSON.parse(fs.readFileSync(new URL('../data/college-menus.json',import.meta.url),'utf8'));
  await storage.seedDocuments('college_menus', [...records,...collegePresets,messMenuPreset].map(c => ({ id: c.id, document: c })));
  const references = [['library','reference-library.json'],['turnover','nutrient-turnover.json'],['dairy','usda-dairy-source.json']].map(([id,file]) => ({ id, document: JSON.parse(fs.readFileSync(new URL(`../data/${file}`,import.meta.url),'utf8')) }));
  await storage.seedDocuments('reference_documents', references);
}
export function listColleges(storage) { return storage.listColleges(); }
export function referenceLibrary(storage) { return storage.referenceLibrary(); }
