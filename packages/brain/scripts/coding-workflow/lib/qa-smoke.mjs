// 真人 QA 的验收命令固化成回归 smoke（审计 #9，旧 controller 1.5.0「E2E 验收脚本必须有 CI 回归宿主」；决策 c8621227）：
// QA + 独立裁判都通过后，把 PASS 的 T-n 里请求预览环境 API 的命令搬进本仓 smoke 目录（cecelia：packages/brain/scripts/smoke）的 cw-<task8>-qa-smoke.sh，
// 预览地址换成 $BRAIN_URL，登记 allowlist（CI 红即挡合并）；有写请求的同时登记 write-targets 并在第一条命令后做生产保护。
// 前提是 spec 要求每个 Q-n 自己造数据（空库可复现），见 prompts/spec.md。
import fs from 'node:fs';
import path from 'node:path';
import { parseQaReport, PRODUCTION_TARGET_RE, PRODUCTION_ASSIGN_RE } from './qa-report.mjs';

export const QA_SMOKE_DIR = 'packages/brain/scripts/smoke';
const ALLOWLIST = 'packages/quality/smoke-allowlist.txt';
const WRITE_TARGETS = 'packages/quality/smoke-write-targets.txt';
// 目录与登记文件按仓库（repos.json qa_smoke，C6）；不传 = 默认仓（cecelia）口径
const DEFAULT_PATHS = { dir: QA_SMOKE_DIR, allowlist: ALLOWLIST, write_targets: WRITE_TARGETS };
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

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '[::1]']);
const LOCAL_HOST_PORT_RE = /\b(?:localhost|127\.0\.0\.1|0\.0\.0\.0)\s*:\s*(\d+)|\[::1\]:(\d+)/g;
// 依赖本机文件/目录：CI 里没有（QA 会话的 worktree、/tmp 下自己写的脚本、家目录）
const LOCAL_PATH_RE = /(?:^|[\s'"=(<>])(?:\/(?:Users|home|private|tmp)\/|~\/)|\bcd\s+\//;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 命令是否请求预览环境 API：字面量「<预览地址>/api/」，或先把预览地址赋给变量（B=<预览地址>、export B='<预览地址>'）
 * 再用 $B/api/、${B}/api/（金丝雀 4 r10/5 r3/6 r3 的写法）。地址后面紧跟数字的不算（5301 ≠ 53010）。
 */
function hitsPreview(command, origin) {
  const o = escapeRe(origin);
  if (new RegExp(`${o}/api/`).test(command)) return true;
  const assign = new RegExp(`\\b([A-Za-z_][A-Za-z0-9_]*)=(['"]?)${o}\\2(?![\\w.:/-])`, 'g');
  return [...command.matchAll(assign)].some(([, v]) => new RegExp(`\\$(?:${v}|\\{${v}\\})/api/`).test(command));
}

/** 预览端口（预览地址是本机时）；预览不在本机时为 null（此时命令里任何本机端口都算别的端口）。 */
function previewPort(origin) {
  try {
    const u = new URL(origin);
    return LOCAL_HOSTS.has(u.hostname) ? (u.port || (u.protocol === 'https:' ? '443' : '80')) : null;
  } catch {
    return null;
  }
}

/**
 * 不能固化的原因；能固化返回 null。依次判：browser（开浏览器）、production（打生产，复用 qa-report 的生产判定）、
 * other_port（打本机其他端口，如金丝雀 5 T-4/T-10 打分支/main 对照 Brain）、local_path（依赖本机路径）、
 * not_preview（没请求预览环境 API）。
 */
export function previewApiSkipReason(command, origin) {
  const cmd = String(command ?? '');
  if (BROWSER_RE.test(cmd)) return 'browser';
  if (PRODUCTION_TARGET_RE.test(cmd) || PRODUCTION_ASSIGN_RE.test(cmd)) return 'production';
  const port = previewPort(origin);
  if ([...cmd.matchAll(LOCAL_HOST_PORT_RE)].some((m) => (m[1] ?? m[2]) !== port)) return 'other_port';
  if (LOCAL_PATH_RE.test(cmd)) return 'local_path';
  if (!hitsPreview(cmd, origin)) return 'not_preview';
  return null;
}

/** 命令是否可固化成回归 smoke（请求预览 API，且不碰生产/本机其他端口/本机路径/浏览器）。 */
export function targetsPreviewApi(command, previewUrl) {
  const origin = String(previewUrl ?? '').replace(/\/+$/, '');
  return origin !== '' && previewApiSkipReason(command, origin) === null;
}

/** 一个 T-n 包进子 shell：退出码非 0 即判失败退出（&& 断言链中途失败时 set -e 不会退出，J-4）。 */
const block = (t, command) => [
  `echo "== ${t.id}（对应 ${t.covers.join('、')}）"`,
  'if ! (',
  command,
  `); then echo "FAIL: ${t.id}" >&2; exit 1; fi`,
].join('\n');

/**
 * 挑 QA 报告里可固化的 T-n：只看 PASS 的；→ { picked: [T-n], skipped: [{ id, reason }], api: [id] }（原因见 previewApiSkipReason）。
 * exclude：[{ id, reason }] 额外剔除的条目（固化前预跑失败的，reason 形如 preflight_failed:22）。
 * api：PASS 的 API 类条目（命令请求了 /api/，不是浏览器操作）——无论最后能否固化，用来判「API 类 PR 零固化」。
 */
export function selectQaSmokeItems({ previewUrl, reportText, exclude = [] }) {
  const origin = String(previewUrl ?? '').replace(/\/+$/, '');
  const excluded = new Map(exclude.map((x) => [x.id, x.reason]));
  const picked = [];
  const skipped = [];
  const api = [];
  for (const t of parseQaReport(reportText).tests.filter((x) => x.verdict === 'PASS')) {
    const reason = origin ? previewApiSkipReason(t.command, origin) : 'not_preview';
    if (reason !== 'browser' && /\/api\//.test(String(t.command ?? ''))) api.push(t.id);
    const why = reason ?? excluded.get(t.id);
    if (why) skipped.push({ id: t.id, reason: why });
    else picked.push(t);
  }
  return { picked, skipped, api };
}

/**
 * 由 QA 报告生成 smoke：{ name, content, writes, items, skipped, commands }；没有可固化的条目返回 null。
 * 只收 PASS、请求预览环境 API（字面量或先赋给变量）、不碰生产/本机其他端口/本机路径/浏览器的 T-n；exclude 见 selectQaSmokeItems。
 * commands：每条 T-n 换好 $BRAIN_URL 后的命令（固化前在预览上逐条预跑用）。
 */
export function buildQaSmoke({ taskId, previewUrl, reportText, exclude = [] }) {
  const origin = String(previewUrl ?? '').replace(/\/+$/, '');
  if (!origin) return null;
  const { picked, skipped } = selectQaSmokeItems({ previewUrl: origin, reportText, exclude });
  if (picked.length === 0) return null;
  // curl 第一个参数统一 -q（不读外部 ~/.curlrc；仓库 smoke 守卫的硬要求）
  const fixCurl = (cmd) => cmd.replace(/\bcurl[ \t]+(?!-q(?:[ \t]|$))/g, 'curl -q ');
  const commands = picked.map((t) => ({ id: t.id, command: fixCurl(replaceOrigin(t.command, origin)) }));
  const blocks = picked.map((t, i) => block(t, commands[i].command));
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
  return { name, content, writes, items: picked.map((t) => t.id), skipped, commands };
}

/** 追加一行（已有则不动）；文件不存在时新建。 */
function appendLine(file, line) {
  const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  if (text.split('\n').includes(line)) return;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${text}${text === '' || text.endsWith('\n') ? '' : '\n'}${line}\n`);
}

/** 写脚本并登记（paths：本仓的 { dir, allowlist, write_targets }）；返回改动的仓库相对路径（交给 QA 记录一并提交）。 */
export function registerSmoke(worktree, smoke, paths = DEFAULT_PATHS) {
  const rel = `${paths.dir}/${smoke.name}`;
  fs.mkdirSync(path.join(worktree, paths.dir), { recursive: true });
  fs.writeFileSync(path.join(worktree, rel), smoke.content, { mode: 0o755 });
  fs.chmodSync(path.join(worktree, rel), 0o755);
  appendLine(path.join(worktree, paths.allowlist), smoke.name);
  const changed = [rel, paths.allowlist];
  if (smoke.writes) {
    appendLine(path.join(worktree, paths.write_targets), smoke.name);
    changed.push(paths.write_targets);
  }
  return changed;
}

const BLOCK_HEAD_RE = /^echo "== (T-\d+)（/;
const blockEnd = (id) => `); then echo "FAIL: ${id}" >&2; exit 1; fi`;
const blockIds = (content) => [...String(content).matchAll(/^echo "== (T-\d+)（/gm)].map((m) => m[1]);

/**
 * Smoke Glob Runner 日志（run-smoke-ratchet.sh 输出，已去 Actions 时间戳）里本 PR smoke 的结果（C2c）：
 * failed = 该脚本被判基线失败（`BASELINE FAIL (exit n): <name>`）；ids = 该脚本输出段（`── ▶  <name>` 到下一个 `── ` / 失败判定行）
 * 里 block() 打出的 `FAIL: T-n`。别的脚本输出的 FAIL 不算。
 */
export function smokeCiFailures(log, name) {
  const lines = String(log ?? '').split('\n').map((l) => l.trim());
  const failed = lines.some((l) => /BASELINE FAIL \(exit \d+\):\s*(\S+)$/.exec(l)?.[1] === name);
  if (!failed) return { failed: false, ids: [] };
  const ids = [];
  const start = lines.findIndex((l) => /^── ▶\s+(\S+)$/.exec(l)?.[1] === name);
  for (let i = start < 0 ? lines.length : start + 1; i < lines.length; i += 1) {
    if (lines[i].startsWith('── ') || /(?:BASELINE|DEBT) FAIL/.test(lines[i])) break;
    const id = /^FAIL: (T-\d+)$/.exec(lines[i])?.[1];
    if (id && !ids.includes(id)) ids.push(id);
  }
  return { failed: true, ids };
}

/** 从 runner 生成的 smoke 里剔除 T-n 块（block() 的格式）：→ { content, removed: [实际剔掉的], items: [剩下的] }。 */
export function dropSmokeBlocks(content, ids) {
  const drop = new Set(ids);
  const lines = String(content).split('\n');
  const out = [];
  const removed = [];
  for (let i = 0; i < lines.length; i += 1) {
    const id = BLOCK_HEAD_RE.exec(lines[i])?.[1];
    const end = id && drop.has(id) ? lines.indexOf(blockEnd(id), i) : -1;
    if (end < 0) {
      out.push(lines[i]);
      continue;
    }
    removed.push(id);
    i = end + (lines[end + 1] === '' ? 1 : 0);
  }
  const text = removed.length ? out.join('\n') : String(content);
  return { content: text, removed, items: blockIds(text) };
}

/** 删一行（没有则不动）；返回是否改了。 */
function removeLine(file, line) {
  if (!fs.existsSync(file)) return false;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const kept = lines.filter((l) => l !== line);
  if (kept.length === lines.length) return false;
  fs.writeFileSync(file, kept.join('\n'));
  return true;
}

/** 剔光后：删脚本、撤 allowlist / write-targets 登记（paths 同 registerSmoke）；返回改动的仓库相对路径。 */
export function unregisterSmoke(worktree, name, paths = DEFAULT_PATHS) {
  const rel = `${paths.dir}/${name}`;
  fs.rmSync(path.join(worktree, rel), { force: true });
  return [rel, ...[paths.allowlist, paths.write_targets].filter((f) => removeLine(path.join(worktree, f), name))];
}
