/**
 * release-gate.js — Brain API 发布准入查账只读端点
 *
 * task_id: f284c0a2-f2ed-4dfc-bd61-ce5416d93c8c
 * contract: sprints/07162100-release-gate-rtm/contract-draft.md
 *
 * GET  /api/brain/release-gate/:pathId → 只读查账，返回 { verdict, gaps, path_id, checked_at }
 * POST/PUT/PATCH/DELETE → 405（只读端点，拒绝所有写操作）
 *
 * INV-07: 端点只接受 GET；POST/PUT/PATCH → 405
 */

import { Router } from 'express';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../../../../..');
const RTM_DIR = join(REPO_ROOT, 'docs', 'rtm');

const router = Router();

// ─── 405 处理器（只读端点） ───────────────────────────────────────────────────

const METHOD_NOT_ALLOWED = (_req, res) => {
  res.setHeader('Allow', 'GET');
  res.status(405).json({ error: 'Method Not Allowed. This endpoint is read-only (GET only).' });
};

router.post('/:pathId', METHOD_NOT_ALLOWED);
router.put('/:pathId', METHOD_NOT_ALLOWED);
router.patch('/:pathId', METHOD_NOT_ALLOWED);
router.delete('/:pathId', METHOD_NOT_ALLOWED);

// ─── RTM 解析（与 CLI 脚本同逻辑，独立实现避免循环依赖） ──────────────────────

const LEVEL_RANK = { L0: 0, L1: 1, L2: 2, L3: 3 };

function parseCommitLevel(text) {
  const isSeamStep = text.includes('（接缝步') || text.includes('(接缝步');
  const match = text.match(/\bL[0-3]\b/);
  const level = match ? match[0] : null;
  return { level, isSeamStep };
}

function parseActualLevel(text) {
  const match = text.match(/\bL[0-3]\b/);
  return match ? match[0] : null;
}

function parseStepId(text) {
  const match = text.match(/\bS\d+\b/);
  return match ? match[0] : text.trim().replace(/\*\*/g, '').trim();
}

function parseRTM(content) {
  const lines = content.split('\n');
  const steps = [];
  let headerIdx = -1;
  let colMap = {};

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith('|')) continue;

    const cells = line.split('|').map(c => c.trim()).filter((_, idx) => idx > 0 && idx < line.split('|').length - 1);
    const hasStepCol = cells.some(c => c.includes('步骤号') || c.includes('步骤'));
    const hasActualCol = cells.some(c => c.includes('实际等级') || c.includes('实际'));
    const hasCommitCol = cells.some(c => c.includes('承诺等级') || c.includes('承诺'));

    if (hasStepCol && hasActualCol && hasCommitCol) {
      headerIdx = i;
      cells.forEach((name, idx) => {
        if (name.includes('步骤号') || name.includes('步骤')) colMap.step = idx;
        if (name.includes('实际等级') || (name.includes('实际') && !name.includes('承诺'))) colMap.actual = idx;
        if (name.includes('承诺等级') || (name.includes('承诺') && !name.includes('实际'))) colMap.commit = idx;
      });
      break;
    }
  }

  if (headerIdx === -1) return steps;

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

function auditRTM(content) {
  const steps = parseRTM(content);
  const gaps = [];

  for (const step of steps) {
    const actualRank = LEVEL_RANK[step.actualLevel] ?? -1;

    if (step.isSeamStep && actualRank < 3) {
      gaps.push({
        stepId: step.stepId,
        reason: '接缝步',
        actual: step.actualLevel,
        commit: step.commitLevel,
      });
    } else if (!step.isSeamStep && step.actualLevel === 'L0' && step.commitLevel !== 'L0') {
      gaps.push({
        stepId: step.stepId,
        reason: 'L0降级',
        actual: step.actualLevel,
        commit: step.commitLevel,
      });
    }
  }

  return { gaps, steps };
}

// ─── GET /api/brain/release-gate/:pathId ─────────────────────────────────────

router.get('/:pathId', (req, res) => {
  const { pathId } = req.params;
  const rtmFile = join(RTM_DIR, `${pathId}.md`);

  if (!existsSync(rtmFile)) {
    return res.status(200).json({
      path_id: pathId,
      verdict: 'NO_RTM',
      gaps: [],
      checked_at: new Date().toISOString(),
      message: `RTM 文件不存在：${rtmFile}`,
    });
  }

  try {
    const content = readFileSync(rtmFile, 'utf-8');
    const { gaps } = auditRTM(content);

    const verdict = gaps.length > 0 ? 'BLOCKED' : 'PASS';

    return res.status(200).json({
      path_id: pathId,
      verdict,
      gaps,
      checked_at: new Date().toISOString(),
      total_gaps: gaps.length,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

export default router;
