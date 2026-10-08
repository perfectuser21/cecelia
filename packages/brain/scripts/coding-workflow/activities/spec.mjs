// spec 活动：用 claude CLI + 薄 prompt 根据 01-intent.md 生成 <sprint_dir>/02-spec.md。
// 格式校验不在这里做，交给 chain_check。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail } from '../lib/protocol.mjs';
import { intentIdsError } from '../lib/intent.mjs';
import {
  loadPrompt, claudeTimeoutMs, runClaude, claudeFailure, snapshotChanges, outOfScopeChanges,
} from '../lib/claude.mjs';
import { sha256File, chainTamperFailure } from '../lib/guards.mjs';

const SPEC_FILE = '02-spec.md';
const INTENT_FILE = '01-intent.md';
// 默认低于契约 budget（900s），这样超时由本活动先报明确的 claude_timeout，而不是执行器笼统的 activity_timeout
const TIMEOUT = { envVar: 'CODING_WF_SPEC_TIMEOUT_MS', defaultMs: 870000 };

await runActivity(async (input) => {
  const { worktree, sprint_dir: sprintDir, intent_ids: intentIds } = input;

  const { dir } = validateBase(input);
  const idsError = intentIdsError(intentIds);
  if (idsError) return fail('fatal', idsError);

  const specPath = path.join(dir, SPEC_FILE);
  const prompt = loadPrompt('spec', {
    TASK_ID: input.task_id,
    INTENT_PATH: path.join(dir, INTENT_FILE),
    SPEC_PATH: specPath,
    INTENT_IDS: intentIds.join(','),
  });

  // 重试/重跑时旧产物会被当成新产物，先删
  fs.rmSync(specPath, { force: true });
  const before = await snapshotChanges(worktree);

  const args = ['-p', prompt, '--permission-mode', 'acceptEdits', '--disallowedTools', 'Bash'];
  const run = await runClaude({ args, cwd: worktree, timeoutMs: claudeTimeoutMs(input.budget, TIMEOUT), tag: 'spec' });
  // 超时/被取消/非 0 直接返回：产物可能写了一半，不检查、不做越界检查
  const failure = claudeFailure(run);
  if (failure) return failure;

  const stray = await outOfScopeChanges(worktree, sprintDir, before, 'spec');
  if (stray.length > 0) {
    return fail('fatal', 'spec_out_of_scope_write', { evidence: [{ out_of_scope_changes: stray }] });
  }
  const tampered = chainTamperFailure(dir, { intent_sha256: input.intent_sha256 });
  if (tampered) return tampered;
  if (!fs.existsSync(specPath)) return fail('fatal', 'spec_missing');

  return {
    status: 'completed',
    outputs: { spec_file: SPEC_FILE, spec_sha256: sha256File(specPath) },
    evidence: [`${SPEC_FILE} 已生成`],
  };
});
