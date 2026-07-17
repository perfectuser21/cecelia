#!/usr/bin/env node
/**
 * release-gate.mjs — RTM 发布准入查账脚本
 *
 * task_id: f284c0a2-f2ed-4dfc-bd61-ce5416d93c8c
 * contract: sprints/07162100-release-gate-rtm/contract-draft.md
 *
 * 用法：
 *   node scripts/release-gate.mjs --path <pathId>
 *   node scripts/release-gate.mjs --rtm <rtmFile>
 *   node scripts/release-gate.mjs --help
 *
 * 退出码：
 *   0 — 全达标（[PASS]），写 decisions 记录
 *   1 — 接缝步 < L3 或非接缝步实际 L0（承诺≠L0）→ [BLOCKED]
 *   2 — RTM 缺失 → [NO_RTM]
 */

import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const RTM_DIR = join(REPO_ROOT, 'docs', 'rtm');
const BRAIN_URL = process.env.BRAIN_URL ?? 'http://host.docker.internal:5221';

// ─── CLI 解析 ────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`release-gate.mjs — RTM 发布准入查账脚本

用法：
  node scripts/release-gate.mjs --path <pathId>
  node scripts/release-gate.mjs --rtm <rtmFile>

参数：
  --path <pathId>   从 docs/rtm/<pathId>.md 读取 RTM
  --rtm  <file>     直接读取指定 RTM 文件

退出码：
  0  全达标（[PASS]）
  1  有缺口（[BLOCKED]）
  2  RTM 缺失（[NO_RTM]）
`);
  process.exit(0);
}

let rtmFile = null;
let pathId = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--rtm' && args[i + 1]) {
    rtmFile = resolve(REPO_ROOT, args[i + 1]);
    // derive pathId from filename (without extension)
    pathId = args[i + 1].replace(/.*\//, '').replace(/\.md$/, '');
    i++;
  } else if (args[i] === '--path' && args[i + 1]) {
    pathId = args[i + 1];
    rtmFile = join(RTM_DIR, `${pathId}.md`);
    i++;
  }
}

if (!rtmFile || !pathId) {
  console.error('错误：必须提供 --path <pathId> 或 --rtm <file>');
  console.error('运行 --help 查看用法');
  process.exit(2);
}

// ─── RTM 存在性检查 ──────────────────────────────────────────────────────────

if (!existsSync(rtmFile)) {
  console.log(`[NO_RTM] 无账可查：${pathId}`);
  process.exit(2);
}

// ─── RTM 解析 ────────────────────────────────────────────────────────────────

/**
 * 等级数值映射（越高越好）
 */
const LEVEL_RANK = { L0: 0, L1: 1, L2: 2, L3: 3 };

/**
 * 从承诺等级列文本中提取等级值（L0/L1/L2/L3）
 * 同时判断是否为接缝步
 */
function parseCommitLevel(text) {
  const isSeamStep = text.includes('（接缝步') || text.includes('(接缝步');
  const match = text.match(/\bL[0-3]\b/);
  const level = match ? match[0] : null;
  return { level, isSeamStep };
}

/**
 * 从实际等级列文本中提取等级值（L0/L1/L2/L3）
 */
function parseActualLevel(text) {
  const match = text.match(/\bL[0-3]\b/);
  return match ? match[0] : null;
}

/**
 * 从步骤号列文本中提取步骤号（如 S1、S14）
 */
function parseStepId(text) {
  const match = text.match(/\bS\d+\b/);
  return match ? match[0] : text.trim().replace(/\*\*/g, '').trim();
}

/**
 * 解析 RTM Markdown 表格，返回步骤列表
 * 支持的表格列（顺序不固定，按表头名匹配）：
 *   步骤号 | ... | 实际等级 | 承诺等级 | ...
 */
function parseRTM(content) {
  const lines = content.split('\n');
  const steps = [];

  // 找到表格（第一行含 | 步骤号 的行为表头）
  let headerIdx = -1;
  let colMap = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;

    // 尝试识别表头
    const cells = line.split('|').map(c => c.trim()).filter((_, idx) => idx > 0 && idx < line.split('|').length - 1);
    // 检查是否含步骤号/实际等级/承诺等级列
    const hasStepCol = cells.some(c => c.includes('步骤号') || c.includes('步骤'));
    const hasActualCol = cells.some(c => c.includes('实际等级') || c.includes('实际'));
    const hasCommitCol = cells.some(c => c.includes('承诺等级') || c.includes('承诺'));

    if (hasStepCol && hasActualCol && hasCommitCol) {
      headerIdx = i;
      // 建立列名 → 索引映射
      cells.forEach((name, idx) => {
        if (name.includes('步骤号') || name.includes('步骤')) colMap.step = idx;
        if (name.includes('实际等级') || (name.includes('实际') && !name.includes('承诺'))) colMap.actual = idx;
        if (name.includes('承诺等级') || (name.includes('承诺') && !name.includes('实际'))) colMap.commit = idx;
      });
      break;
    }
  }

  if (headerIdx === -1) return steps;

  // 跳过分隔行（下一行通常是 |---|---|...）
  const dataStart = headerIdx + 2;

  for (let i = dataStart; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) break;

    const cells = line.split('|').map(c => c.trim()).filter((_, idx) => idx > 0 && idx < line.split('|').length - 1);
    if (cells.length < 3) continue;

    const stepRaw = cells[colMap.step] ?? '';
    const actualRaw = cells[colMap.actual] ?? '';
    const commitRaw = cells[colMap.commit] ?? '';

    const stepId = parseStepId(stepRaw);
    const actualLevel = parseActualLevel(actualRaw);
    const { level: commitLevel, isSeamStep } = parseCommitLevel(commitRaw);

    if (!stepId || !actualLevel || !commitLevel) continue;

    steps.push({ stepId, actualLevel, commitLevel, isSeamStep });
  }

  return steps;
}

// ─── 查账逻辑 ────────────────────────────────────────────────────────────────

const content = readFileSync(rtmFile, 'utf-8');
const steps = parseRTM(content);

if (steps.length === 0) {
  console.log(`[NO_RTM] 无账可查（RTM 解析失败或表格为空）：${pathId}`);
  process.exit(2);
}

const blocked = [];

for (const step of steps) {
  const actualRank = LEVEL_RANK[step.actualLevel] ?? -1;
  const commitRank = LEVEL_RANK[step.commitLevel] ?? -1;

  if (step.isSeamStep && actualRank < 3) {
    // 接缝步：实际等级 < L3 → 拦截
    blocked.push({
      stepId: step.stepId,
      reason: '接缝步',
      actual: step.actualLevel,
      commit: step.commitLevel,
    });
  } else if (!step.isSeamStep && step.actualLevel === 'L0' && step.commitLevel !== 'L0') {
    // 非接缝步：实际 L0 但承诺不是 L0 → 拦截
    blocked.push({
      stepId: step.stepId,
      reason: 'L0降级',
      actual: step.actualLevel,
      commit: step.commitLevel,
    });
  }
}

// ─── 输出 & 退出 ─────────────────────────────────────────────────────────────

if (blocked.length > 0) {
  for (const b of blocked) {
    console.log(`[BLOCKED] ${b.stepId} ${b.reason} 实际 ${b.actual} < 承诺 ${b.commit}`);
  }
  process.exit(1);
}

// 全达标：写 decisions 记录
console.log(`[PASS] ${pathId} 全部接缝步实际等级已达承诺等级，发布准入通过`);

try {
  const payload = {
    category: 'release-gate',
    level: 'feature',
    topic: pathId,
    decision: 'PASS',
    reason: 'All seam-steps meet L3 commit level; release gate approved.',
  };

  const res = await fetch(`${BRAIN_URL}/api/brain/decisions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5000),
  });

  if (!res.ok) {
    console.error(`[PASS] decisions 写库失败（HTTP ${res.status}），但查账结果已输出`);
  } else {
    console.log(`[PASS] decisions 已写库（category=release-gate, verdict=PASS）`);
  }
} catch (err) {
  // Brain API 不可达不影响本地查账结果
  console.error(`[PASS] decisions 写库跳过（Brain API 不可达：${err.message}）`);
}

process.exit(0);
