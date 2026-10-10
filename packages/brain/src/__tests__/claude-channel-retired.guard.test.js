/**
 * Claude Code 无头调用通道防复活守卫（任务 76a160b3，决策 067867c8）
 *
 * 主理人曾因 claude -p / 订阅 OAuth 被自动化调用而封号，通道已彻底下线。
 * 本守卫扫描 packages/brain、packages/workflows 下全部非测试、非文档源码，
 * 任何能重新拉起 claude CLI 的写法出现即红。白名单：lib/claude-channel.js 自身，
 * 以及整个 scripts/coding-workflow/ 目录（新编码流水线 runClaude/spawnClaude 用机器默认 Claude 登录，
 * 主理人 2026-10-10 决定保留，见决策 3859041e）。
 *
 * 判据（每条都必须能自证会报警，见末尾 describe）：
 *   R1 进程类调用（spawn/exec/execFile/…，含 doSpawn 之类包装）首参是 claude 命令字面量
 *   R2 命令位上的 claude（行首/管道/&&/;/env 前缀之后）且带 -p/--print/--resume/--session-id
 *   R3 command/cmd/bin 等字段的取值落到 claude 字面量（含 `?? 'claude'` / `|| 'claude'` 兜底）
 *   R4 claude 二进制绝对路径字面量（/opt/homebrew/bin/claude 等，存在即只为执行它）
 *   R5 以 CLAUDE_BIN / claudeBin / discoverClaudeBin 作为命令来源
 *   R6 引用 claude-launch.sh 启动器（它唯一用途是拉起 claude）
 *   R7 argv 数组首元素是 claude 且紧跟参数（['claude', '-p', …] 交给任意执行器）
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BRAIN_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const REPO_ROOT = path.resolve(BRAIN_ROOT, '../..');
const SCAN_ROOTS = [BRAIN_ROOT, path.join(REPO_ROOT, 'packages/workflows')];
const SOURCE_EXT = new Set(['.js', '.cjs', '.mjs', '.ts']);
const SKIP_DIRS = new Set(['node_modules', '__tests__', 'tests', 'test', 'fixtures', '__fixtures__', 'docs', 'coverage', 'dist', '.git']);
const WHITELIST = new Set([path.join(BRAIN_ROOT, 'src/lib/claude-channel.js')]);
// 主理人 2026-10-10 决定保留新编码流水线（runClaude/spawnClaude），见决策 3859041e
const WHITELIST_DIRS = [path.join(BRAIN_ROOT, 'scripts/coding-workflow') + path.sep];
const CODING_WORKFLOW_CLAUDE = path.join(BRAIN_ROOT, 'scripts/coding-workflow/lib/claude.mjs');

function isWhitelisted(file) {
  return WHITELIST.has(file) || WHITELIST_DIRS.some((dir) => file.startsWith(dir));
}

const CMD = String.raw`(?:\S*\/)?claude`;
const RULES = [
  { id: 'R1', re: new RegExp(String.raw`\b\w*(?:spawn|Spawn|exec|Exec|fork)\w*\s*\(\s*(['"\x60])${CMD}\1`) },
  { id: 'R2', re: new RegExp(String.raw`(?:^|['"\x60]|(?:&&|\|\||[;|]|\$\(|\bexec|\benv(?:\s+\w+=\S+)*|\btimeout\s+\S+|\bnohup|\bsetsid)\s+)(?<!\b(?:grep|pgrep|pkill)\s+(?:-\S+\s+)*['"]?)${CMD}\s+(?:[^|;&'"\n]*\s)?(?:-p|--print|--resume|--session-id)\b`) },
  { id: 'R3', re: new RegExp(String.raw`\b(?:command|cmd|bin|binary|executable)\s*[:=][^,;\n]*(['"\x60])${CMD}\1`) },
  { id: 'R4', re: /['"`](?:\/opt\/homebrew\/bin|\/usr\/local\/bin|[^'"`\s]*\/\.local\/bin|[^'"`\s]*\/\.npm-global\/bin)\/claude['"`]/ },
  { id: 'R5', re: /\b(?:CLAUDE_BIN|claudeBin|discoverClaudeBin)\b/ },
  { id: 'R6', re: /claude-launch\.sh/ },
  { id: 'R7', re: new RegExp(String.raw`\[\s*(['"\x60])${CMD}\1\s*,\s*(['"\x60])-`) },
];

function isTestOrDoc(file) {
  return /\.(test|spec)\.[cm]?[jt]s$/.test(file) || file.endsWith('.d.ts');
}

function collectSources(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const full = path.join(dir, name);
    const st = lstatSync(full);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) collectSources(full, out);
    else if (SOURCE_EXT.has(path.extname(name)) && !isTestOrDoc(name)) out.push(full);
  }
  return out;
}

/** 去掉整行注释与块注释里的内容，保留行号对齐；只扫可执行代码。 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((line) => (/^\s*(\/\/|#|\*)/.test(line) ? '' : line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1')));
}

export function findClaudeInvocations(src) {
  const hits = [];
  stripComments(src).forEach((line, i) => {
    for (const rule of RULES) {
      if (rule.re.test(line)) hits.push({ rule: rule.id, line: i + 1, text: line.trim().slice(0, 160) });
    }
  });
  return hits;
}

function scanOffenders() {
  const offenders = [];
  for (const root of SCAN_ROOTS) {
    for (const file of collectSources(root)) {
      if (isWhitelisted(file)) continue;
      for (const hit of findClaudeInvocations(readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(REPO_ROOT, file)}:${hit.line} [${hit.rule}] ${hit.text}`);
      }
    }
  }
  return offenders;
}

describe('Claude 无头通道防复活守卫：源码扫描', () => {
  it('packages/brain 与 packages/workflows 非测试源码中不存在任何拉起 claude CLI 的写法', () => {
    const offenders = scanOffenders();
    expect(offenders, `发现 claude 无头调用路径：\n${offenders.join('\n')}`).toEqual([]);
  });

  it('白名单生效而非守卫失灵：coding-workflow 的 claude 启动写法能被判据识别，但不进 offenders', () => {
    const src = readFileSync(CODING_WORKFLOW_CLAUDE, 'utf8');
    expect(findClaudeInvocations(src).length).toBeGreaterThan(0);
    expect(collectSources(BRAIN_ROOT)).toContain(CODING_WORKFLOW_CLAUDE);
    expect(isWhitelisted(CODING_WORKFLOW_CLAUDE)).toBe(true);
    expect(isWhitelisted(path.join(BRAIN_ROOT, 'src/executor.js'))).toBe(false);
    expect(scanOffenders().filter((o) => o.includes('scripts/coding-workflow/'))).toEqual([]);
  });

  it('单一来源常量模块存在且声明通道已退役', async () => {
    const mod = await import('../lib/claude-channel.js');
    expect(mod.CLAUDE_CHANNEL_RETIRED).toBe(true);
    expect(mod.CLAUDE_CHANNEL_RETIRED_CODE).toBe('claude_channel_retired');
    expect(() => mod.assertClaudeChannelRetired('guard')).toThrow(/claude_channel_retired/);
    const err = (() => { try { mod.assertClaudeChannelRetired('x'); } catch (e) { return e; } })();
    expect(err).toBeInstanceOf(mod.ClaudeChannelRetiredError);
    expect(err.code).toBe('claude_channel_retired');
    expect(mod.isClaudeCommand('claude')).toBe(true);
    expect(mod.isClaudeCommand('/opt/homebrew/bin/claude')).toBe(true);
    expect(mod.isClaudeCommand('"/usr/local/bin/claude"')).toBe(true);
    expect(mod.isClaudeCommand('claude-launch.sh')).toBe(true);
    expect(mod.isClaudeCommand('codex')).toBe(false);
    expect(mod.isClaudeCommand('docker')).toBe(false);
    expect(mod.isClaudeCommand('ssh')).toBe(false);
    expect(mod.isClaudeCommand(undefined)).toBe(false);
  });
});

describe('守卫自证：每条判据都会报警', () => {
  it.each([
    ['R1', "const p = spawn('claude', ['-p', prompt]);"],
    ['R1', "execFile('claude', ['-p', ...args], cb);"],
    ['R1', 'const r = spawnSync("/opt/homebrew/bin/claude", args);'],
    ['R1', "await doSpawn('claude');"],
    ['R2', "exec(`claude -p ${prompt}`);"],
    ['R2', "const cmd = 'cd /tmp && claude --print hi';"],
    ['R2', "const c = 'env A=1 claude --resume abc';"],
    ['R3', "const bin = process.env.X_BIN || 'claude';"],
    ['R3', "command: execution.command ?? 'claude',"],
    ['R4', "const p = '/opt/homebrew/bin/claude';"],
    ['R5', 'llm.run({ command: CLAUDE_BIN, args });'],
    ['R6', "const launcher = path.join(repo, 'scripts/claude-launch.sh');"],
    ['R7', "cmdArgs = ['claude', '--dangerously-skip-permissions', '-p'];"],
  ])('%s 命中：%s', (rule, line) => {
    expect(findClaudeInvocations(line).map((h) => h.rule)).toContain(rule);
  });

  it.each([
    ["execSync(\"ps -eo pid,ppid,args | grep 'claude -p' | grep -v grep\")"],
    ["if (!bin.endsWith('/claude') && bin !== 'claude') continue;"],
    ["const ENGINE_NAMES = ['codex', 'claude', 'terra'];"],
    ["spawn('codex', ['exec', prompt]);"],
    ["// spawn('claude', ['-p'])  注释不算"],
    ["provider: 'claude',"],
    ["desc: '派发并监控任务，bridge → claude -p /skill 调用链',"],
    ["const TIER_C_BODY = /Skill\\s*\\(|claude -p\\b/;"],
  ])('不误报：%s', (line) => {
    expect(findClaudeInvocations(line)).toEqual([]);
  });
});
