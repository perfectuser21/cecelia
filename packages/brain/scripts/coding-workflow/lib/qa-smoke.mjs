// 真人 QA 的验收命令固化成回归 smoke（审计 #9，旧 controller 1.5.0「E2E 验收脚本必须有 CI 回归宿主」；决策 c8621227）：
// QA + 独立裁判都通过后，把 PASS 的 T-n 里请求预览环境 API 的命令搬进 packages/brain/scripts/smoke/cw-<task8>-qa-smoke.sh，
// 预览地址换成 $BRAIN_URL，登记 allowlist（CI 红即挡合并）；有写请求的同时登记 write-targets 并在第一条命令后做生产保护。
// 前提是 spec 要求每个 Q-n 自己造数据（空库可复现），见 prompts/spec.md。
import fs from 'node:fs';
import path from 'node:path';
import { parseQaReport } from './qa-report.mjs';

export const QA_SMOKE_DIR = 'packages/brain/scripts/smoke';
const ALLOWLIST = 'packages/quality/smoke-allowlist.txt';
const WRITE_TARGETS = 'packages/quality/smoke-write-targets.txt';
const BROWSER_RE = /\bplaywright\b|\bchromium\b|\bpuppeteer\b|qa-page/i;
// 同 packages/quality/tests/smoke-production-guard.node-test.mjs 的写请求判定
const HTTP_WRITE_RE = /\b(?:curl|brain_curl)\b[^\n]*-X\s+(POST|PATCH|DELETE|PUT|["']?\$)/;

/**
 * 预览地址换成 $BRAIN_URL，按所在引号上下文写成能展开的形式（金丝雀 4 裁判 J-4：单引号里写 "$BRAIN_URL" 不展开）：
 * 单引号里 '"$BRAIN_URL"'（先闭合单引号）；双引号里 $BRAIN_URL；不在引号里 "$BRAIN_URL"。
 */
export function replaceOrigin(command, origin) {
  let out = '';
  let quote = null;
  for (let i = 0; i < command.length;) {
    if (command.startsWith(origin, i)) {
      out += quote === "'" ? `'"$BRAIN_URL"'` : quote === '"' ? '$BRAIN_URL' : '"$BRAIN_URL"';
      i += origin.length;
      continue;
    }
    const c = command[i];
    if (c === '\\' && quote !== "'") {
      out += command.slice(i, i + 2);
      i += 2;
      continue;
    }
    if ((c === "'" || c === '"') && (quote === null || quote === c)) quote = quote ? null : c;
    out += c;
    i += 1;
  }
  return out;
}

/** 一个 T-n 包进子 shell：退出码非 0 即判失败退出（&& 断言链中途失败时 set -e 不会退出，J-4）。 */
const block = (t, command) => [
  `echo "== ${t.id}（对应 ${t.covers.join('、')}）"`,
  'if ! (',
  command,
  `); then echo "FAIL: ${t.id}" >&2; exit 1; fi`,
].join('\n');

/**
 * 由 QA 报告生成 smoke：{ name, content, writes, items }；没有可固化的条目返回 null。
 * 只收 PASS、请求预览环境 API（命令里出现 previewUrl/api/）、不开浏览器的 T-n。
 */
export function buildQaSmoke({ taskId, previewUrl, reportText }) {
  const origin = String(previewUrl ?? '').replace(/\/+$/, '');
  if (!origin) return null;
  const picked = parseQaReport(reportText).tests.filter((t) => t.verdict === 'PASS'
    && t.command.includes(`${origin}/api/`) && !BROWSER_RE.test(t.command));
  if (picked.length === 0) return null;
  // curl 第一个参数统一 -q（不读外部 ~/.curlrc；仓库 smoke 守卫的硬要求）
  const fixCurl = (cmd) => cmd.replace(/\bcurl[ \t]+(?!-q(?:[ \t]|$))/g, 'curl -q ');
  const blocks = picked.map((t) => block(t, fixCurl(replaceOrigin(t.command, origin))));
  const writes = picked.some((t) => HTTP_WRITE_RE.test(t.command.replace(/\\\r?\n/g, ' ')));
  const name = `cw-${String(taskId).slice(0, 8)}-qa-smoke.sh`;
  const content = [
    '#!/usr/bin/env bash',
    `# coding workflow 任务 ${taskId} 的真人 QA 验收命令固化（审计 #9）：QA 与独立裁判通过后由 runner 生成，勿手改`,
    '# 场景按 spec 要求自己造数据，CI 空库可复现；失败即回归。',
    'set -euo pipefail',
    ...(writes ? [
      '# 真 Brain 写入必须显式授权，并核对本机测试容器。',
      'if ! node "$(dirname "${BASH_SOURCE[0]}")/../lib/smoke-production-guard.mjs" "${BRAIN_URL:-http://localhost:5221}"; then',
      '  exit 0',
      'fi',
    ] : []),
    'BRAIN_URL="${BRAIN_URL:-http://localhost:5221}"',
    '',
    ...blocks.flatMap((b) => [b, '']),
    `echo "PASS: ${name}"`,
    '',
  ].join('\n');
  return { name, content, writes, items: picked.map((t) => t.id) };
}

/** 追加一行（已有则不动）；文件不存在时新建。 */
function appendLine(file, line) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.split('\n').includes(line)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`);
}

/** 写脚本并登记；返回改动的仓库相对路径（交给 QA 记录一并提交）。 */
export function registerSmoke(worktree, smoke) {
  const rel = `${QA_SMOKE_DIR}/${smoke.name}`;
  fs.mkdirSync(path.join(worktree, QA_SMOKE_DIR), { recursive: true });
  fs.writeFileSync(path.join(worktree, rel), smoke.content, { mode: 0o755 });
  fs.chmodSync(path.join(worktree, rel), 0o755);
  appendLine(path.join(worktree, ALLOWLIST), smoke.name);
  const changed = [rel, ALLOWLIST];
  if (smoke.writes) {
    appendLine(path.join(worktree, WRITE_TARGETS), smoke.name);
    changed.push(WRITE_TARGETS);
  }
  return changed;
}
