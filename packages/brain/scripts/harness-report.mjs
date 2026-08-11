#!/usr/bin/env node
/**
 * harness-report.mjs — Harness report artifact script
 *
 * Usage:
 *   node packages/brain/scripts/harness-report.mjs \
 *     --sprint-dir <dir> \
 *     --task-id <uuid> \
 *     --pr-url <url> \
 *     --feature-id <uuid|empty>
 *
 * Steps:
 *   S1: Read sprint-dir artifacts
 *   S2: Generate harness-report.md
 *   S3: Generate learning.md
 *   S4: Generate index.html
 *   S5: PATCH tasks.result via Brain API (harness/complete)
 *   S6: Feature 状态与锚点由已认证的 Brain callback 写回
 *   S7: POST note via Brain API
 *
 * Exit:
 *   0 = success or partial HTTP non-2xx (non-fatal)
 *   1 = PARTIAL_FAIL (Brain API unreachable / connection error on S5/S7)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// ── CLI argument parsing ─────────────────────────────────────────────────────
function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--') && i + 1 < argv.length) {
      result[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return result;
}

const cliArgs = parseArgs(process.argv.slice(2));
const required = ['sprint-dir', 'task-id', 'pr-url'];
const missing = required.filter(k => !cliArgs[k]);
if (missing.length) {
  const msg = `Error: missing required arguments: ${missing.map(k => '--' + k).join(', ')}\n` +
    'Usage: node harness-report.mjs --sprint-dir <dir> --task-id <id> --pr-url <url> --feature-id <id>';
  process.stderr.write(msg + '\n');
  process.exit(1);
}

const SPRINT_DIR = resolve(cliArgs['sprint-dir']);
const TASK_ID    = cliArgs['task-id'];
const PR_URL     = cliArgs['pr-url'];
const BRAIN_URL  = process.env.BRAIN_URL || 'http://localhost:5221';

// ── S1: Read sprint-dir artifacts ────────────────────────────────────────────
let meta = { gan_rounds: 'N/A', final_e2e_verdict: 'N/A', pr_url: PR_URL };
try {
  const evalPath = join(SPRINT_DIR, 'evaluator-output.json');
  if (existsSync(evalPath)) {
    const evalData = JSON.parse(readFileSync(evalPath, 'utf8'));
    if (evalData.gan_rounds !== undefined) meta.gan_rounds = evalData.gan_rounds;
    if (evalData.final_e2e_verdict !== undefined) meta.final_e2e_verdict = evalData.final_e2e_verdict;
    if (evalData.pr_url) meta.pr_url = evalData.pr_url;
  }
} catch (_) { /* degraded mode — use N/A defaults */ }

// ── Slice3: 上线/Production 字段（report 后移补全）──────────────────────────
// 优先 CLI arg，回退 env（executor 从 task.payload 注入）。读不到 → N/A（降级，不报错）。
const slice3 = {
  report_kind:        cliArgs['report-kind']        || process.env.REPORT_KIND        || 'success',
  staging_e2e_verdict: cliArgs['staging-e2e-verdict'] || process.env.STAGING_E2E_VERDICT || meta.final_e2e_verdict,
  promote_status:     cliArgs['promote-status']     || process.env.PROMOTE_STATUS     || 'N/A',
  promoted_by:        cliArgs['promoted-by']        || process.env.PROMOTED_BY        || 'N/A',
  promoted_at:        cliArgs['promoted-at']        || process.env.PROMOTED_AT        || 'N/A',
  production_version: cliArgs['production-version'] || process.env.PRODUCTION_VERSION || 'N/A',
  rollback_anchor:    cliArgs['rollback-anchor']    || process.env.ROLLBACK_ANCHOR    || 'N/A',
};
const isFailureReport = slice3.report_kind === 'failure';

// ── S2: Generate harness-report.md ──────────────────────────────────────────
const reportLines = [
  '# Harness Sprint Report',
  '',
  `Sprint: ${SPRINT_DIR}`,
  `PR: ${PR_URL}`,
  `GAN Rounds: ${meta.gan_rounds}`,
  `Final E2E Verdict: ${meta.final_e2e_verdict}`,
  `Report Kind: ${slice3.report_kind}`,
  `Generated: ${new Date().toISOString()}`,
  '',
  '## 摘要',
  '',
  meta.gan_rounds === 'N/A'
    ? 'evaluator-output.json 缺失，字段值为 N/A（降级报告）'
    : `Sprint 完成，共 ${meta.gan_rounds} 轮 GAN，最终 E2E 验收：${meta.final_e2e_verdict}`,
  '',
  // Slice3：report 后移到 production promote 完成后——补全上线信息。
  isFailureReport ? '## 未上线（失败报告）' : '## 上线 / Production',
  '',
  `- Staging E2E: ${slice3.staging_e2e_verdict}`,
  `- Promote 状态: ${slice3.promote_status}`,
  isFailureReport
    ? '- 本 initiative 未通过验收 / 未上 production（失败报告，无生产版本与回档锚点）'
    : `- 放行人: ${slice3.promoted_by}  |  放行时间: ${slice3.promoted_at}`,
  isFailureReport ? '' : `- Production 版本: ${slice3.production_version}`,
  isFailureReport ? '' : `- 回档锚点: ${slice3.rollback_anchor}`,
  '',
  '## 步骤耗时',
  '',
  '（详见 initiative_runs 表 step_timing 字段）',
].join('\n');

writeFileSync(join(SPRINT_DIR, 'harness-report.md'), reportLines + '\n');
console.log(`[S2] harness-report.md generated`);

// ── S3: Generate learning.md ─────────────────────────────────────────────────
const learningContent = [
  '# Sprint Learning',
  '',
  `Sprint: ${SPRINT_DIR}`,
  `Generated: ${new Date().toISOString()}`,
  '',
  '## Insights (Placeholder)',
  '',
  'This sprint produced the following key learnings:',
  '- report generation is now scriptized (harness-report.mjs)',
  '- git zero-touch maintained throughout',
  '',
  '## Notes',
  '',
  'placeholder — LLM-generated insights available when ANTHROPIC_API_KEY is configured',
].join('\n');

writeFileSync(join(SPRINT_DIR, 'learning.md'), learningContent + '\n');
console.log(`[S3] learning.md generated`);

// ── S4: Generate index.html ──────────────────────────────────────────────────
const escaped = reportLines
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

const htmlContent = `<!DOCTYPE html>
<html lang="zh">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Harness Sprint Report</title>
  <style>
    body { font-family: monospace; padding: 2em; max-width: 900px; margin: 0 auto; }
    pre { background: #f5f5f5; padding: 1em; border-radius: 4px; overflow-x: auto; }
    h1 { color: #333; }
  </style>
</head>
<body>
  <h1>Harness Sprint Report</h1>
  <pre>${escaped}</pre>
</body>
</html>
`;

writeFileSync(join(SPRINT_DIR, 'index.html'), htmlContent);
console.log(`[S4] index.html generated`);

// ── Brain API helpers ────────────────────────────────────────────────────────
const connectionErrors = [];

async function brainPost(path, body) {
  const url = `${BRAIN_URL}/api/brain${path}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp;
}

// ── S5: PATCH tasks.result via harness/complete ──────────────────────────────
try {
  const resp = await brainPost('/harness/complete', {
    initiative_id: TASK_ID,
    pr_url: PR_URL,
    sprint_dir: SPRINT_DIR,
  });
  if (resp.ok) {
    const data = await resp.json().catch(() => ({}));
    console.log(`[S5] tasks.result.pr_url updated (rowsAffected=${data.rowsAffected ?? '?'})`);
  } else {
    console.warn(`[S5] tasks update returned HTTP ${resp.status} — non-fatal`);
  }
} catch (err) {
  console.error(`[S5] FAIL: ${err.message}`);
  connectionErrors.push(`S5: ${err.message}`);
}

// ── S6: Journey Feature 权威写回 ────────────────────────────────────────────
// Report Runner 不持有 Cecelia 内部通用凭据。Feature done 与测试锚点由收到
// authenticated terminal callback 的 Brain 进程统一写回，避免候选代码越权改地图。

// ── S7: POST notes ────────────────────────────────────────────────────────────
try {
  const sprintName = SPRINT_DIR.split('/').pop() || SPRINT_DIR;
  const resp = await brainPost('/notes', {
    title: `[Harness Report] Sprint ${sprintName}`,
    content: [
      `Sprint: ${SPRINT_DIR}`,
      `PR: ${PR_URL}`,
      `Task: ${TASK_ID}`,
      `GAN Rounds: ${meta.gan_rounds}`,
      `Verdict: ${meta.final_e2e_verdict}`,
      `Generated: ${new Date().toISOString()}`,
    ].join('\n'),
    type: 'report',
  });
  if (resp.ok) {
    console.log(`[S7] notes record created`);
  } else {
    console.warn(`[S7] notes POST returned HTTP ${resp.status} — non-fatal`);
  }
} catch (err) {
  console.error(`[S7] FAIL: ${err.message}`);
  connectionErrors.push(`S7: ${err.message}`);
}

// ── Final exit ────────────────────────────────────────────────────────────────
if (connectionErrors.length > 0) {
  console.error(`PARTIAL_FAIL: ${connectionErrors.join('; ')}`);
  process.exit(1);
}
