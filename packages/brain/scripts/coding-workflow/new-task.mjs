#!/usr/bin/env node
// 建 coding workflow 任务（Commander 与 /dev 小改动的入口）：node new-task.mjs <plan.json> [--dry-run] [--repo <仓库>]
// plan 两种形状：
//   单条 { title, change_kind, map_scope_hint: [..], description?, acceptance: [..], priority?, gp_anchor?, base_sha? }
//   一批 { batch?, tasks: [{ key, title, acceptance, depends_on?: [前面任务的 key], ... }] }（大改拆成有序小任务）
// 每条建成 coding_workflow 任务（runner 自动认领跑七步链）；depends_on 的 key 换成前面已建任务的真实 id。
// plan 顶层可写 project_id（已有 project 根）或 project: { name, description? }（先建再挂），整批都挂上；
// 有 depends_on 时必须二选一（Brain 要求带依赖的任务挂 project 根），两者不能同时给。
// 仓库（C6）：单条 t.repo > 计划顶层 repo > --repo > 默认仓 cecelia；别名 / owner/repo / URL 经 repos.json 归一成规范 key 写进 payload.repo，
// 未登记的拒绝（不猜）；未启用仓库最终由 Brain 拒绝。change_kind/map_scope_hint/base_sha 可从批次顶层继承。base_sha 如提供，须为计划选定的目标仓库真实commit（通常来自origin/main），格式为40位小写hex。
// 先整体校验再逐条创建；中途失败退出 1 并列出已建的任务。输出 [{key,id,title}]。
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRepos, resolveRepo, reposFile, resolveEntry } from './runner/lib/repos.mjs';
import { normalizeChangeKind } from '../../src/impact-contract/change-kind.js';
import { validateAuthority, sameAuthority, loadAuthorityIndex, trustedHead, resolveAuthority } from './lib/authority-refs.mjs';

const nonEmpty = (s) => typeof s === 'string' && s.trim() !== '';

/** 计划 → { tasks（每条带 repoKey）, batch, projectId, project, errors }（errors 非空即不可建）。opts.repo：命令行 --repo。 */
export function validatePlan(plan, { repo = null, repos = loadRepos(reposFile()) } = {}) {
  const raw = Array.isArray(plan?.tasks) ? plan.tasks : [plan];
  const errors = [];
  const keys = new Set();
  const tasks = raw.map((t, i) => {
    const wanted = [t?.repo, plan?.repo, repo].find((v) => nonEmpty(v)) ?? null;
    const repoKey = resolveRepo(wanted, repos);
    if (!repoKey) errors.push(`#${i + 1}:repo_unknown:${wanted}`);
    const inherit = (key) => Object.hasOwn(t ?? {}, key) ? t[key] : plan?.[key];
    let changeKind;
    try {
      changeKind = normalizeChangeKind(inherit('change_kind'));
      if (!changeKind) errors.push(`#${i + 1}:change_kind_required`);
    } catch { errors.push(`#${i + 1}:invalid_change_kind`); }
    const baseSha = inherit('base_sha');
    if (baseSha !== undefined && (typeof baseSha !== 'string' || !/^[a-f0-9]{40}$/.test(baseSha))) {
      errors.push(`#${i + 1}:invalid_base_sha`);
    }
    const scope = inherit('map_scope_hint');
    if (!Array.isArray(scope) || scope.length === 0) errors.push(`#${i + 1}:map_scope_required`);
    else if (!scope.every(nonEmpty)) errors.push(`#${i + 1}:invalid_map_scope`);
    const mapScope = Array.isArray(scope) && scope.every(nonEmpty) ? [...new Set(scope.map((v) => v.trim()))] : [];
    const declaredObject = inherit('object_id');
    const declaredRefs = inherit('authority_refs');
    const nested = inherit('authority');
    const authority = nested ?? (declaredObject !== undefined || declaredRefs !== undefined
      ? { object_id: declaredObject, refs: declaredRefs } : undefined);
    if (nested !== undefined && (declaredObject !== undefined || declaredRefs !== undefined)
      && !sameAuthority(nested, { object_id: declaredObject, refs: declaredRefs })) errors.push(`#${i + 1}:authority_declaration_conflict`);
    if (authority !== undefined) errors.push(...validateAuthority(authority).map((error) => `#${i + 1}:${error}`));
    return { ...t, repoKey, changeKind, mapScope, baseSha, authority };
  });
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

function body(t, batch, ids, projectId) {
  const payload = {
    coding_workflow: true,
    repo: t.repoKey,
    gp_anchor: nonEmpty(t.gp_anchor) ? t.gp_anchor : 'none(infra)',
    acceptance: t.acceptance,
  };
  if (t.depends_on?.length) payload.depends_on = t.depends_on.map((k) => ids.get(k));
  if (batch) payload.batch = batch;
  if (t.key !== undefined) payload.plan_key = t.key;
  if (t.authority !== undefined) {
    payload.authority_required = true;
    payload.authority = t.authority;
    payload.object_id = t.authority.object_id;
    payload.authority_refs = t.authority.refs;
  }
  const req = {
    // 独立类型（派发总闸 F，任务 0a70684f）：tick 按类型排除，不再借 data + headed_manual
    task_type: 'coding_workflow',
    mutation_intent: 'write',
    change_kind: t.changeKind,
    repo_hint: t.repoKey,
    map_scope_hint: t.mapScope,
    title: t.title,
    description: t.description ?? '',
    priority: t.priority ?? 'P2',
    trigger_source: 'manual',
    payload,
  };
  if (t.baseSha !== undefined) req.base_sha = t.baseSha;
  if (projectId) req.project_id = projectId;
  return req;
}

/** POST JSON → { ok, reply }；网络错误折成 { ok: false, reply: { error } }。 */
async function postJson(url, data) {
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const reply = await res.json().catch(() => null);
    return { ok: res.ok && Boolean(reply?.id), status: res.status, reply };
  } catch (error) {
    return { ok: false, status: 0, reply: { error: String(error?.message || error) } };
  }
}

async function receipt(url, method = 'GET', data) {
  try {
    const res = await fetch(url, { method, headers: { 'content-type': 'application/json' },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => null) };
  } catch { return { ok: false, status: 0, body: null }; }
}

function managedMatches(row, t) {
  return row?.task_type === 'coding_workflow' && row?.payload?.authority_required === true
    && sameAuthority(row.payload.authority, t.authority) && row.payload.repo === t.repoKey
    && row.payload.object_id === t.authority.object_id
    && sameAuthority(row.payload.authority_refs, t.authority.refs)
    && row.payload.change_kind === t.changeKind
    && row.payload.work_kind === 'coding_mutation'
    && row.payload.orchestrator === 'coding-workflow-runner'
    && Array.isArray(row.payload.map_scope)
    && JSON.stringify([...row.payload.map_scope].sort()) === JSON.stringify([...t.mapScope].sort())
    && (t.baseSha === undefined || row.payload.base_sha === t.baseSha);
}

async function settleMismatch(base, id) {
  const claim = await receipt(`${base}/tasks/${encodeURIComponent(id)}/claim`, 'POST', {
    claimer: 'coding-workflow-new-task', executor_kind: 'coding-workflow-runner',
  });
  if (!claim.ok) return 'unresolved_claim';
  const running = await receipt(`${base}/tasks/${encodeURIComponent(id)}`, 'PATCH', { status: 'in_progress' });
  if (!running.ok) return 'unresolved_in_progress';
  const failed = await receipt(`${base}/tasks/${encodeURIComponent(id)}`, 'PATCH', {
    status: 'failed', result: { coding_workflow_runner: {
      reason_code: 'authority_receipt_mismatch', detail: 'POST 与独立 GET 的受管引用或仓库路由不一致',
      evidence: [{ task_id: id, actor: 'coding-workflow-new-task' }],
    } },
  });
  if (!failed.ok) return 'unresolved_failed_patch';
  const final = await receipt(`${base}/tasks/${encodeURIComponent(id)}`);
  return final.ok && final.body?.status === 'failed' ? 'failed_confirmed' : 'unresolved_final_receipt';
}

const USAGE = '用法：node new-task.mjs <plan.json> [--dry-run] [--repo <仓库>]';

/** 命令行 → { file, dryRun, repo }；--repo 缺值返回 null。 */
function parseArgs(argv) {
  const out = { file: null, dryRun: false, repo: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a.startsWith('--repo=')) out.repo = a.slice('--repo='.length);
    else if (a === '--repo') {
      if (!nonEmpty(argv[i + 1]) || argv[i + 1].startsWith('--')) return null;
      out.repo = argv[i += 1];
    } else if (!a.startsWith('--') && !out.file) out.file = a;
  }
  return out;
}

async function main(argv, env) {
  const args = parseArgs(argv);
  if (!args?.file) {
    console.error(USAGE);
    return 2;
  }
  const { file, dryRun } = args;
  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`读不了计划文件：${error.message}`);
    return 2;
  }
  const repos = loadRepos(reposFile(env));
  const checked = validatePlan(plan, { repo: args.repo, repos });
  const { tasks, batch, project, errors } = checked;
  let { projectId } = checked;
  if (tasks.some((t) => t.authority !== undefined)) {
    const clone = env.CODING_WF_TRUSTED_REPO || resolveEntry(repos.find((r) => r.default), env).clone;
    const fixed = trustedHead(clone);
    let index;
    try { index = fixed ? loadAuthorityIndex(clone, fixed) : null; }
    catch (error) { errors.push(error.message); }
    if (!index) errors.push('authority_index_binding_missing');
    else tasks.forEach((t, i) => {
      if (t.authority === undefined) return;
      errors.push(...validateAuthority(t.authority, index).map((error) => `#${i + 1}:${error}`));
      if (validateAuthority(t.authority, index).length === 0) {
        const failed = resolveAuthority(clone, t.authority.refs, { trustedSha: fixed }).find((r) => r.required && r.status !== 'found');
        if (failed) errors.push(`#${i + 1}:${failed.reason}`);
      }
    });
  }
  if (errors.length > 0) {
    console.error(`计划不合格：${errors.join(' ')}`);
    return 2;
  }
  if (dryRun) {
    console.log(JSON.stringify(tasks.map((t) => ({ key: t.key ?? null, title: t.title, repo: t.repoKey, depends_on: t.depends_on ?? [] }))));
    return 0;
  }
  for (const key of new Set(tasks.map((t) => t.repoKey))) {
    if (!repos.find((r) => r.key === key)?.enabled) console.error(`注意：仓库 ${key} 在 repos.json 未启用（enabled=false），Brain 会拒绝无头建单；请先确认开闸部署`);
  }
  const base = `${String(env.BRAIN_URL || 'http://localhost:5221').replace(/\/+$/, '')}/api/brain`;
  if (project) {
    const { ok, reply } = await postJson(`${base}/projects`, project);
    if (!ok) {
      console.error(`建 project 失败：${JSON.stringify(reply)}`);
      return 1;
    }
    projectId = reply.id;
  }
  const ids = new Map();
  const created = [];
  for (const t of tasks) {
    const { ok, status, reply } = await postJson(`${base}/tasks`, body(t, batch, ids, projectId));
    if (!ok) {
      if (t.authority !== undefined && (status === 200 || status === 201)) {
        console.error(`authority_dedup_conflict: id=${reply?.id ?? 'unknown'}；新建身份未确认，停止后续建单`);
        return 1;
      }
      console.error(`建任务「${t.title}」失败：${JSON.stringify(reply)}；已建：${JSON.stringify(created)}`);
      return 1;
    }
    if (t.authority !== undefined) {
      if (status !== 201 || reply?.deduplicated === true || !/^[a-f0-9-]{36}$/i.test(reply.id)) {
        console.error(`authority_dedup_conflict: id=${reply.id}；复用或新建身份未确认，停止后续建单`);
        return 1;
      }
      const read = await receipt(`${base}/tasks/${encodeURIComponent(reply.id)}`);
      if (!read.ok || !managedMatches(reply, t) || !managedMatches(read.body, t)) {
        const outcome = await settleMismatch(base, reply.id);
        console.error(`authority_receipt_mismatch: id=${reply.id} outcome=${outcome}；停止后续建单`);
        return 1;
      }
    }
    const actual = reply.payload;
    if (reply.task_type !== 'coding_workflow' || actual?.coding_workflow !== true
      || actual?.work_kind !== 'coding_mutation' || actual?.orchestrator !== 'coding-workflow-runner'
      || actual?.repo !== t.repoKey || actual?.change_kind !== t.changeKind
      || (t.baseSha !== undefined && actual?.base_sha !== t.baseSha)
      || !Array.isArray(actual?.map_scope)
      || JSON.stringify([...actual.map_scope].sort()) !== JSON.stringify([...t.mapScope].sort())) {
      console.error(`task_route_mismatch：${JSON.stringify({ id: reply.id, task_type: reply.task_type,
        repo: actual?.repo, work_kind: actual?.work_kind, change_kind: actual?.change_kind,
        orchestrator: actual?.orchestrator, expected_base_sha: t.baseSha, base_sha: actual?.base_sha })}；已建：${JSON.stringify(created)}；停止后续建单，先核查此任务`);
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
