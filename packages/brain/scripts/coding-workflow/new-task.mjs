#!/usr/bin/env node
// 建 coding workflow 任务（Commander 与 /dev 小改动的入口）：node new-task.mjs <plan.json> [--dry-run]
// plan 两种形状：
//   单条 { title, description?, acceptance: [..], priority?, gp_anchor? }
//   一批 { batch?, tasks: [{ key, title, acceptance, depends_on?: [前面任务的 key], ... }] }（大改拆成有序小任务）
// 每条建成带开关的 data 任务（runner 自动认领跑七步链）；depends_on 的 key 换成前面已建任务的真实 id。
// plan 顶层可写 project_id（已有 project 根）或 project: { name, description? }（先建再挂），整批都挂上；
// 有 depends_on 时必须二选一（Brain 要求带依赖的任务挂 project 根），两者不能同时给。
// 先整体校验再逐条创建；中途失败退出 1 并列出已建的任务。输出 [{key,id,title}]。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

/** 计划 → { tasks, batch, projectId, project, errors }（errors 非空即不可建）。 */
export function validatePlan(plan) {
  const tasks = Array.isArray(plan?.tasks) ? plan.tasks : [plan];
  const errors = [];
  const keys = new Set();
  tasks.forEach((t, i) => {
    const at = `#${i + 1}`;
    if (!nonEmpty(t?.title)) errors.push(`${at}:title_missing`);
    if (!Array.isArray(t?.acceptance) || t.acceptance.length === 0 || !t.acceptance.every(nonEmpty)) {
      errors.push(`${at}:acceptance_missing`);
    }
    for (const dep of t?.depends_on ?? []) if (!keys.has(dep)) errors.push(`${at}:depends_on_unknown:${dep}`);
    if (t?.key !== undefined) {
      if (keys.has(t.key)) errors.push(`${at}:key_duplicate:${t.key}`);
      keys.add(t.key);
    }
  });
  const projectId = nonEmpty(plan?.project_id) ? plan.project_id : null;
  const given = plan?.project !== undefined && plan?.project !== null;
  if (given && !nonEmpty(plan.project?.name)) errors.push('project_name_missing');
  if (given && plan?.project_id !== undefined) errors.push('project_conflict');
  if (!projectId && !given && tasks.some((t) => t?.depends_on?.length)) errors.push('project_required');
  const project = given ? { name: plan.project.name, description: plan.project.description ?? '' } : null;
  return { tasks, batch: nonEmpty(plan?.batch) ? plan.batch : null, projectId, project, errors };
}

function body(t, batch, ids) {
  const payload = {
    coding_workflow: true,
    headed_manual: 'true',
    repo: 'cecelia',
    gp_anchor: nonEmpty(t.gp_anchor) ? t.gp_anchor : 'none(infra)',
    acceptance: t.acceptance,
  };
  if (t.depends_on?.length) payload.depends_on = t.depends_on.map((k) => ids.get(k));
  if (batch) payload.batch = batch;
  if (t.key !== undefined) payload.plan_key = t.key;
  return {
    task_type: 'data',
    title: t.title,
    description: t.description ?? '',
    priority: t.priority ?? 'P2',
    trigger_source: 'manual',
    payload,
  };
}

async function main(argv, env) {
  const file = argv.find((a) => !a.startsWith('--'));
  const dryRun = argv.includes('--dry-run');
  if (!file) {
    console.error('用法：node new-task.mjs <plan.json> [--dry-run]');
    return 2;
  }
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`读不了计划文件：${error.message}`);
    return 2;
  }
  const { tasks, batch, errors } = validatePlan(plan);
  if (errors.length > 0) {
    console.error(`计划不合格：${errors.join(' ')}`);
    return 2;
  }
  if (dryRun) {
    console.log(JSON.stringify(tasks.map((t) => ({ key: t.key ?? null, title: t.title, depends_on: t.depends_on ?? [] }))));
    return 0;
  }
  const url = `${String(env.BRAIN_URL || 'http://localhost:5221').replace(/\/+$/, '')}/api/brain/tasks`;
  const ids = new Map();
  const created = [];
  for (const t of tasks) {
    let res;
    let reply = null;
    try {
      res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body(t, batch, ids)) });
      reply = await res.json().catch(() => null);
    } catch (error) {
      reply = { error: String(error?.message || error) };
    }
    if (!res?.ok || !reply?.id) {
      console.error(`建任务「${t.title}」失败：${JSON.stringify(reply)}；已建：${JSON.stringify(created)}`);
      return 1;
    }
    if (t.key !== undefined) ids.set(t.key, reply.id);
    created.push({ key: t.key ?? null, id: reply.id, title: t.title });
  }
  console.log(JSON.stringify(created));
  return 0;
}

let direct = false;
try {
  direct = fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch { /* 被 import 时不执行 */ }
if (direct) main(process.argv.slice(2), process.env).then((code) => { process.exitCode = code; });
