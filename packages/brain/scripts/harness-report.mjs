/**
 * harness-report.mjs — Harness 报告生成 CLI 脚本
 *
 * 用法：node packages/brain/scripts/harness-report.mjs
 *   --sprint-dir <dir>    (必填) Sprint 产出目录
 *   --task-id <id>        (必填) Brain task UUID
 *   --pr-url <url>        (必填) PR URL
 *   --feature-id <id>     (必填) journey_features UUID
 *
 * 退出码：全步成功 → 0；任一步失败 → 1
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_BRAIN_URL = process.env.BRAIN_URL || 'http://localhost:5221';

// ─── 可导出的函数（供测试 + 内联调用）────────────────────────────────────────

/**
 * 在 sprintDir 下生成三份报告文件
 * opts.fs — 可替换为 mock（测试用）
 * opts.taskId / opts.prUrl — 报告头部信息
 */
export async function generateReportFiles(sprintDir, opts = {}) {
  const fsImpl = opts.fs || { writeFileSync, existsSync, readFileSync };
  const taskId = opts.taskId || '';
  const prUrl = opts.prUrl || '';
  const now = new Date().toISOString();

  let prdContent = '';
  const prdPath = join(sprintDir, 'sprint-prd.md');
  if (fsImpl.existsSync(prdPath)) {
    try { prdContent = fsImpl.readFileSync(prdPath, 'utf8'); } catch (_) { /* ignore */ }
  } else {
    prdContent = '[sprint-prd.md 不存在，已跳过]';
  }

  let contractContent = '';
  const contractPath = join(sprintDir, 'contract-draft.md');
  if (fsImpl.existsSync(contractPath)) {
    try {
      const raw = fsImpl.readFileSync(contractPath, 'utf8');
      contractContent = raw.slice(0, 3000);
    } catch (_) { /* ignore */ }
  } else {
    contractContent = '[contract-draft.md 不存在，已跳过]';
  }

  const prNum = prUrl ? prUrl.split('/').pop() : 'N/A';
  const reportMd = [
    '# Sprint Report',
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    `Sprint: ${sprintDir}`,
    `Task ID: ${taskId}`,
    `PR #: ${prNum}`,
    `PR URL: ${prUrl}`,
    `Generated: ${now}`,
    '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    '',
    '## Summary',
    '（AI 洞察段待补）',
    '',
    '## Sprint PRD',
    prdContent,
    '',
    '## Contract',
    contractContent,
  ].join('\n');

  fsImpl.writeFileSync(join(sprintDir, 'harness-report.md'), reportMd);

  const learningMd = [
    '# Learning Report',
    `Generated: ${now}`,
    `Sprint: ${sprintDir}`,
    `Task ID: ${taskId}`,
    '',
    '## Learnings',
    '（AI 洞察段待补）',
  ].join('\n');
  fsImpl.writeFileSync(join(sprintDir, 'learning.md'), learningMd);

  const safeReport = reportMd.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const indexHtml = [
    '<!DOCTYPE html>',
    '<html lang="zh">',
    '<head><meta charset="UTF-8"><title>Sprint Report</title></head>',
    '<body>',
    `<h1>Sprint Report</h1>`,
    `<p>Sprint: ${sprintDir}</p>`,
    `<p>Task: ${taskId}</p>`,
    `<p>PR URL: <a href="${prUrl}">${prUrl}</a></p>`,
    `<pre>${safeReport}</pre>`,
    '</body>',
    '</html>',
  ].join('\n');
  fsImpl.writeFileSync(join(sprintDir, 'index.html'), indexHtml);
}

/**
 * PATCH tasks/{id} status=completed
 */
export async function patchTaskCompleted(taskId, opts = {}) {
  const brainUrl = opts.brainUrl || DEFAULT_BRAIN_URL;
  const fetchFn = opts.fetch || fetch;
  const res = await fetchFn(`${brainUrl}/api/brain/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'completed', result: { completed_at: new Date().toISOString() } }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH task/${taskId} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * PATCH journey_features/{id} — 仅发 status:done，禁发 thickness 字段（stale fix 已移除）
 */
export async function patchFeatureDone(featureId, opts = {}) {
  const brainUrl = opts.brainUrl || DEFAULT_BRAIN_URL;
  const fetchFn = opts.fetch || fetch;
  // 注意：不发 thickness 字段（该字段无此枚举值，发了 Brain 返 400）
  const res = await fetchFn(`${brainUrl}/api/brain/journey_features/${featureId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'done' }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`PATCH journey_features/${featureId} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * Upsert api_registry + test_registry（ON CONFLICT → 幂等 upsert）
 */
export async function upsertRegistries(taskId, opts = {}) {
  const brainUrl = opts.brainUrl || DEFAULT_BRAIN_URL;
  const fetchFn = opts.fetch || fetch;
  const results = [];

  try {
    const res = await fetchFn(`${brainUrl}/api/brain/registry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `harness-report-api-${taskId}`,
        type: 'api',
        location: 'packages/brain/scripts/harness-report.mjs',
        status: 'active',
        description: `harness-report CLI script for task ${taskId}`,
        metadata: { task_id: taskId },
      }),
    });
    results.push({ type: 'api', ok: res.ok, status: res.status });
  } catch (err) {
    results.push({ type: 'api', ok: false, error: err.message });
    throw err;
  }

  try {
    const res = await fetchFn(`${brainUrl}/api/brain/registry`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `harness-report-test-${taskId}`,
        type: 'test',
        location: 'packages/brain/src/__tests__/harness-report-script.test.js',
        status: 'active',
        description: `vitest unit tests for harness-report script, task ${taskId}`,
        metadata: { task_id: taskId },
      }),
    });
    results.push({ type: 'test', ok: res.ok, status: res.status });
  } catch (err) {
    results.push({ type: 'test', ok: false, error: err.message });
    throw err;
  }

  return results;
}

// ─── CLI 入口（仅在直接执行时运行）────────────────────────────────────────────

// psql -t 在部分 PG 版本下仍输出 "INSERT 0 1" 行，导致 UUID 参数含噪声后缀
// 例如 "uuid\n\nINSERT01\n"。本函数提取第一个合法 UUID，否则 trim() 兜底。
const sanitizeUUID = (val) => {
  if (!val) return val;
  const match = val.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match ? match[0] : val.trim();
};

async function main() {
  // ── 参数解析 ──────────────────────────────────────────────────────────────
  const args = process.argv.slice(2);
  const get = (flag) => {
    const i = args.indexOf(flag);
    return i !== -1 ? args[i + 1] : null;
  };

  const sprintDir = get('--sprint-dir');
  const taskId = sanitizeUUID(get('--task-id'));
  const prUrl = get('--pr-url');
  const featureId = sanitizeUUID(get('--feature-id'));

  if (!sprintDir || !taskId || !prUrl || !featureId) {
    process.stderr.write(
      'Usage: node harness-report.mjs --sprint-dir <dir> --task-id <id> --pr-url <url> --feature-id <fid>\n' +
      'Error: missing required args: ' +
      [!sprintDir && '--sprint-dir', !taskId && '--task-id', !prUrl && '--pr-url', !featureId && '--feature-id']
        .filter(Boolean).join(', ') + '\n'
    );
    process.exit(1);
  }

  const brainUrl = DEFAULT_BRAIN_URL;
  const results = {};

  // ── Step 1: 生成报告三文件 ────────────────────────────────────────────────
  try {
    // sprint-prd.md / contract-draft.md 不存在 → generateReportFiles 内部处理 WARN
    const hasPrd = existsSync(join(sprintDir, 'sprint-prd.md'));
    const hasContract = existsSync(join(sprintDir, 'contract-draft.md'));
    if (!hasPrd) console.warn(`WARN: sprint-prd.md not found in ${sprintDir}, skipping prd section`);
    if (!hasContract) console.warn(`WARN: contract-draft.md not found in ${sprintDir}, skipping contract section`);
    await generateReportFiles(sprintDir, { taskId, prUrl });
    results.reportFiles = '✅';
    console.log(`✅ Step 1: report files generated (harness-report.md / learning.md / index.html)`);
  } catch (err) {
    results.reportFiles = '❌';
    console.error(`❌ Step 1: report files generation FAILED: ${err.message}`);
  }

  // ── Step 2: PATCH task status=completed ──────────────────────────────────
  try {
    await patchTaskCompleted(taskId, { brainUrl });
    results.taskPatch = '✅';
    console.log(`✅ Step 2: task ${taskId} status=completed`);
  } catch (err) {
    results.taskPatch = '❌';
    console.error(`❌ Step 2: task PATCH FAILED: ${err.message}`);
  }

  // ── Step 3: PATCH feature status=done（无 thickness）────────────────────
  try {
    await patchFeatureDone(featureId, { brainUrl });
    results.featurePatch = '✅';
    console.log(`✅ Step 3: feature ${featureId} status=done`);
  } catch (err) {
    results.featurePatch = '❌';
    console.error(`❌ Step 3: feature PATCH FAILED: ${err.message}`);
  }

  // ── Step 4: Upsert registry（api + test）────────────────────────────────
  try {
    await upsertRegistries(taskId, { brainUrl });
    results.registry = '✅';
    console.log(`✅ Step 4: registry upsert OK (api + test)`);
  } catch (err) {
    results.registry = '❌';
    console.error(`❌ Step 4: registry upsert FAILED: ${err.message}`);
  }

  // ── Step 5: POST report note（非阻断）────────────────────────────────────
  try {
    const noteTitle = `[Harness Report] task:${taskId}`;
    const noteContent = [
      `Sprint: ${sprintDir}`,
      `Task: ${taskId}`,
      `PR URL: ${prUrl}`,
      `Feature: ${featureId}`,
      `Generated: ${new Date().toISOString()}`,
    ].join('\n');
    const res = await fetch(`${brainUrl}/api/brain/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: noteTitle, content: noteContent, type: 'sprint_report', initiative_id: taskId }),
    });
    if (res.ok) {
      results.reportNote = '✅';
      console.log(`✅ Step 5: report note posted`);
    } else {
      const text = await res.text().catch(() => '');
      results.reportNote = '❌';
      console.warn(`❌ Step 5: report note POST failed (${res.status}): ${text.slice(0, 100)}`);
    }
  } catch (err) {
    results.reportNote = '❌';
    console.warn(`❌ Step 5: report note POST failed (non-blocking): ${err.message}`);
  }

  // ── 分步汇总 ──────────────────────────────────────────────────────────────
  const allPass = Object.values(results).every(v => v === '✅');
  console.log('\n─── 分步汇总 ───────────────────────────────');
  console.log(`  报告文件:   ${results.reportFiles ?? '─'}`);
  console.log(`  task PATCH: ${results.taskPatch ?? '─'}`);
  console.log(`  feature:    ${results.featurePatch ?? '─'}`);
  console.log(`  registry:   ${results.registry ?? '─'}`);
  console.log(`  report note:${results.reportNote ?? '─'}`);
  console.log('────────────────────────────────────────────');
  if (allPass) {
    console.log('✅ harness-report.mjs 全步成功');
    process.exit(0);
  } else {
    console.error('❌ harness-report.mjs 部分步骤失败（见上方 ❌）');
    process.exit(1);
  }
}

// 仅在直接执行时运行 main（避免 import 时触发）
const isMain = process.argv[1] && (
  process.argv[1].endsWith('harness-report.mjs') ||
  process.argv[1].endsWith('harness-report')
);
if (isMain) {
  main().catch(err => {
    console.error('FATAL:', err.message);
    process.exit(1);
  });
}
