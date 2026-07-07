import { Router } from 'express';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { runJudgeGate } from '../harness-judge.js';

const router = Router();

router.get('/echo', (req, res) => {
  const msg = req.query.msg !== undefined ? String(req.query.msg) : null;
  res.json({ ok: true, echo: msg === null ? null : msg });
});

/**
 * POST /api/brain/harness/judge
 *
 * thin wrapper 包 runJudgeGate（跨 repo API 化，controller 只需 curl $BRAIN_URL）。
 * FIXED 归一 PASS（前科语义）；agent_verdict 缺省时从 <worktree>/.brain-result.json 读。
 * HTTP 200 恒定，verdict 承载裁决（PASS/FAIL），参数缺失返回 400。
 *
 * Body: { task_id, sprint_dir, worktree, agent_verdict?, agent_feedback?, prompt_dir?, transcript_file? }
 * Response: { verdict, feedback, judged }
 */
router.post('/judge', async (req, res) => {
  const { task_id, sprint_dir, worktree, agent_verdict, agent_feedback, prompt_dir, transcript_file } = req.body || {};

  if (!task_id || !sprint_dir || !worktree) {
    return res.status(400).json({ error: 'task_id, sprint_dir, worktree 均为必填项' });
  }

  // FIXED 归一 PASS（前科语义：evaluator 历史上输出 FIXED 含义等同 PASS）
  function normalizeVerdict(v) {
    const s = String(v || '').trim().toUpperCase();
    if (s === 'FIXED') return 'PASS';
    if (s === 'PASS') return 'PASS';
    if (s === 'FAIL') return 'FAIL';
    return null;
  }

  // agent_verdict 缺省 → 从 <worktree>/.brain-result.json 读
  let resolvedVerdict = normalizeVerdict(agent_verdict);
  if (resolvedVerdict === null) {
    try {
      const brJson = await readFile(path.join(worktree, '.brain-result.json'), 'utf8');
      const br = JSON.parse(brJson);
      resolvedVerdict = normalizeVerdict(br.verdict) || 'FAIL';
    } catch {
      resolvedVerdict = 'FAIL';
    }
  }

  try {
    const result = await runJudgeGate({
      agentVerdict: resolvedVerdict,
      agentFeedback: agent_feedback || null,
      worktreePath: worktree,
      sprintDir: sprint_dir,
      taskId: task_id,
      promptDir: prompt_dir || null,
      instanceLabel: task_id,
      transcript: transcript_file || null,
    });

    return res.json({
      verdict: result.verdict,
      feedback: result.feedback ?? null,
      judged: result.judged ?? false,
    });
  } catch (err) {
    console.error('[POST /harness/judge]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
