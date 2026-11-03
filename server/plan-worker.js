import { parentPort, workerData } from 'node:worker_threads';
import { generatePlan } from './active-planner.js';
import { foods, catalogVersion } from './catalog.js';

const plan = generatePlan(workerData.state, foods, workerData.target, workerData.start);
parentPort.postMessage({ ...plan, catalogVersion });
