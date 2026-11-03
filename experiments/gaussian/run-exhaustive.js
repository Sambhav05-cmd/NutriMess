import fs from 'node:fs';
import { foods, messMenuPreset } from '../../server/catalog.js';
import { newStudent } from '../../server/accounts.js';
import { targets, monday } from '../../server/nutrition.js';
import { generateExhaustivePlan, exhaustiveSearchSize, scoreStrategy } from './planner.js';

// Pass an exported student state with --state=path.json, or use --menu=sample/nitk.
const args = Object.fromEntries(process.argv.slice(2).map(arg => {
  const [key,...rest] = arg.replace(/^--/,'').split('='); return [key,rest.join('=') || true];
}));
const state = args.state ? JSON.parse(fs.readFileSync(args.state,'utf8')) : newStudent();
if (!args.state && (args.menu || 'nitk') === 'nitk') state.menu = structuredClone(messMenuPreset.menu);
state.logs = []; state.completedMeals = [];
const start = args.start || monday(), target = targets(state.profile);
console.error('Raw search space:', JSON.stringify(exhaustiveSearchSize(state,foods,start)));
if (args.estimate) process.exit(0);
const began = performance.now();
const plan = generateExhaustivePlan(state,foods,target,start,{
  maxNodes: args['max-nodes'] ? Number(args['max-nodes']) : Infinity,
  onProgress: progress => console.error(JSON.stringify(progress))
});
const result = {elapsedMs:performance.now()-began, score:scoreStrategy(plan,foods,target,state.profile,state), plan};
const json = JSON.stringify(result,null,2)+'\n';
if (args.out) fs.writeFileSync(args.out,json); else console.log(json);
console.error(plan.search.complete ? 'Exhaustive search completed; optimality proven.' : 'Search budget reached; this is NOT a proven optimum.', JSON.stringify(plan.search));
