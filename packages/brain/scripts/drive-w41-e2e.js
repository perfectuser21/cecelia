/**
 * drive-w41-e2e.js — W41 Walking Skeleton B19 端到端驱动脚本
 *
 * 功能：
 *   - collectEvidence()：从 Brain DB + logs 采集 5 类原始证据文件
 *   - evidenceFileNames()：返回 5 类证据文件名列表
 *   - waitForCompletion(taskId, opts)：轮询直到 task status=completed 或超时
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const EVIDENCE_DIR = 'sprints/w41-walking-skeleton-final-b19/evidence';

export function evidenceFileNames() {
  return [
    'seed-output.json',
    'pr-url-trace.txt',
    'evaluator-checkout-proof.txt',
    'dispatch-events.csv',
    'brain-log-excerpt.txt',
  ];
}

export async function collectEvidence(opts = {}) {
  const brainUrl = opts.brainUrl || process.env.BRAIN_URL || 'http://localhost:5221';
  const taskId = opts.taskId;

  mkdirSync(EVIDENCE_DIR, { recursive: true });

  const evidence = {};

  try {
    if (taskId) {
      const taskRes = await fetch(`${brainUrl}/api/brain/tasks/${taskId}`);
      const task = await taskRes.json();
      writeFileSync(join(EVIDENCE_DIR, 'seed-output.json'), JSON.stringify({
        demo_task_id: taskId,
        injected_at: task.created_at || new Date().toISOString(),
        task_type: task.task_type,
      }, null, 2));
      evidence['seed-output.json'] = true;

      const eventsRes = await fetch(`${brainUrl}/api/brain/tasks/${taskId}/events`);
      const events = eventsRes.ok ? await eventsRes.json() : [];
      const csvLines = ['round,status,pr_url,pr_branch'];
      if (Array.isArray(events)) {
        events.forEach((e, i) => {
          const r = e.result || {};
          csvLines.push(`${i + 1},${r.verdict || ''},${r.pr_url || ''},${r.pr_branch || ''}`);
        });
      }
      writeFileSync(join(EVIDENCE_DIR, 'dispatch-events.csv'), csvLines.join('\n'));
      evidence['dispatch-events.csv'] = true;

      const result = task.result || {};
      const traceLines = [];
      if (Array.isArray(events)) {
        events.forEach((e, i) => {
          const r = e.result || {};
          if (r.pr_url) {
            traceLines.push(`round=${i + 1} status=${r.verdict || ''} pr_url=${r.pr_url} pr_branch=${r.pr_branch || ''}`);
          }
        });
      }
      writeFileSync(join(EVIDENCE_DIR, 'pr-url-trace.txt'), traceLines.join('\n'));
      evidence['pr-url-trace.txt'] = true;

      const proofLines = [
        `PR_BRANCH=${result.pr_branch || ''}`,
        `evaluator_HEAD=${result.evaluator_head || ''}`,
        `checked_at=${new Date().toISOString()}`,
        `demo_task_id=${taskId}`,
        `verdict=${result.verdict || ''}`,
      ];
      writeFileSync(join(EVIDENCE_DIR, 'evaluator-checkout-proof.txt'), proofLines.join('\n'));
      evidence['evaluator-checkout-proof.txt'] = true;

      writeFileSync(join(EVIDENCE_DIR, 'brain-log-excerpt.txt'), `task_id=${taskId}\nstatus=${task.status}\n`);
      evidence['brain-log-excerpt.txt'] = true;
    }
  } catch (err) {
    evidence._error = err.message;
  }

  return evidence;
}

export async function waitForCompletion(taskId, opts = {}) {
  const brainUrl = opts.brainUrl || process.env.BRAIN_URL || 'http://localhost:5221';
  const timeoutMs = opts.timeoutMs || 300000;
  const intervalMs = opts.intervalMs || 5000;

  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${brainUrl}/api/brain/tasks/${taskId}`);
      if (res.ok) {
        const task = await res.json();
        if (task.status === 'completed' || task.status === 'failed') {
          return task;
        }
      }
    } catch {
      // network error, retry
    }
    await new Promise(r => setTimeout(r, intervalMs));
  }

  throw new Error(`Task ${taskId} did not complete within ${timeoutMs}ms`);
}
