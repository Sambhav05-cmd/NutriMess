import { Worker } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';
import { dateKey, monday, targets } from './nutrition.js';

// One optimizer worker per process bounds memory use on small hosting instances.
const jobs = new Map(), queue = [];
let active = null;
const planningInputs = student => ({ profile: student.profile, menu: student.menu, attendance: student.attendance, extras: student.extras });

function pump() {
  if (active || !queue.length) return;
  const task = queue.shift();
  if (task.cancelled) { task.reject(new Error('Cancelled')); pump(); return; }
  active = task;
  let settled = false;
  let worker;
  try { worker = new Worker(new URL('./plan-worker.js', import.meta.url), { workerData: task.data, resourceLimits: { maxOldGenerationSizeMb: 256 } }); }
  catch (error) { active = null; task.reject(error); pump(); return; }
  task.worker = worker;
  const timeout = setTimeout(() => finish(new Error('Initial plan generation timed out after 60 seconds')), 60000);
  function finish(error, result) {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    worker.terminate().finally(() => {
      active = null;
      if (error) task.reject(error); else task.resolve(result);
      pump();
    });
  }
  task.cancel = () => { task.cancelled = true; finish(new Error('Cancelled')); };
  worker.once('message', plan => finish(null, plan));
  worker.once('error', error => finish(error));
  worker.once('exit', () => { if (!settled) finish(new Error('Initial plan worker exited before completion')); });
}

function optimize(job, data) {
  return new Promise((resolve, reject) => {
    if (queue.length >= 8) { reject(new Error('Initial plan queue is full')); return; }
    const task = { data, resolve, reject, cancelled: false };
    job.cancel = () => {
      task.cancelled = true;
      if (task.cancel) task.cancel();
      else { const index = queue.indexOf(task); if (index >= 0) queue.splice(index, 1); reject(new Error('Cancelled')); }
    };
    queue.push(task);
    pump();
  });
}

export function ensureInitialPlan(storage, id) {
  if (jobs.has(id)) return;
  const job = { storage, cancelled: false };
  jobs.set(id, job);
  job.promise = (async () => {
    let token;
    try {
      const initial = await storage.getStudent(id);
      if (job.cancelled || initial?.student.initialPlan?.status !== 'pending') return;
      token = initial.student.initialPlan.jobId;
      const inputs = planningInputs(initial.student), fingerprint = JSON.stringify(inputs);
      const state = { ...structuredClone(inputs), logs: [], completedMeals: [] };
      const plan = await optimize(job, { state, target: targets(state.profile), start: monday() });
      if (job.cancelled) return;
      for (let attempt = 0; attempt < 3; attempt++) {
        const current = await storage.getStudent(id);
        if (!current || current.student.initialPlan?.jobId !== token || current.student.initialPlan.status !== 'pending') return;
        const student = current.student;
        if (student.plan || student.activations?.length) student.initialPlan.status = 'superseded';
        else if (JSON.stringify(planningInputs(student)) !== fingerprint) {
          student.initialPlan = { status: 'pending', jobId: randomUUID(), requestedAt: new Date().toISOString() };
        } else {
          student.plan = plan;
          student.activations = [{ id: randomUUID(), from: dateKey(), name: 'Initial optimized plan', days: plan.days.map(day => ({ entries: day.entries })) }];
          student.initialPlan.status = 'ready';
        }
        try {
          await storage.saveStudent(id, student, current.revision);
          if (student.initialPlan.status === 'pending') job.retry = true;
          return;
        } catch (error) { if (error.status !== 409 || attempt === 2) throw error; }
      }
    } catch (error) {
      if (job.cancelled) return;
      console.error(`Initial plan job failed (${error.name || 'Error'}). The account remains available.`);
      try {
        const current = await storage.getStudent(id);
        if (current?.student.initialPlan?.jobId === token && current.student.initialPlan.status === 'pending') {
          current.student.initialPlan.status = 'failed';
          await storage.saveStudent(id, current.student, current.revision);
        }
      } catch { /* Keep pending work recoverable on the next request. */ }
    } finally {
      jobs.delete(id);
      if (job.retry && !job.cancelled) ensureInitialPlan(storage, id);
    }
  })();
}

export async function cancelInitialPlans(storage) {
  const pending = [...jobs.values()].filter(job => job.storage === storage);
  for (const job of pending) { job.cancelled = true; job.cancel?.(); }
  await Promise.allSettled(pending.map(job => job.promise));
}
