// spec 活动：用 claude CLI + 薄 prompt 根据 01-intent.md 生成 <sprint_dir>/02-spec.md。
// 生成后自检 02（frontmatter、upstream 覆盖全部 I-n、至少一条 S-n）；跨文件整链校验仍由 chain_check 做。
import fs from 'node:fs';
import path from 'node:path';
import { runActivity, validateBase, fail } from '../lib/protocol.mjs';
import { intentIdsError } from '../lib/intent.mjs';
import {
  loadPrompt, claudeTimeoutMs, runClaude, claudeFailure, snapshotChanges, outOfScopeChanges,
} from '../lib/claude.mjs';
import { sha256File, chainTamperFailure } from '../lib/guards.mjs';
import { SPEC_FILE, INTENT_FILE, specErrors } from '../lib/spec-check.mjs';
import { INVARIANTS_FILE, loadInvariantIds } from '../lib/invariants.mjs';

// 默认低于契约 budget（900s），这样超时由本活动先报明确的 claude_timeout，而不是执行器笼统的 activity_timeout
const TIMEOUT = { envVar: 'CODING_WF_SPEC_TIMEOUT_MS', defaultMs: 870000 };

await runActivity(async (input) => {
  const { worktree, sprint_dir: sprintDir, intent_ids: intentIds } = input;

  const { dir } = validateBase(input);
  const idsError = intentIdsError(intentIds);
  if (idsError) return fail('fatal', idsError);

  const specPath = path.join(dir, SPEC_FILE);
  const invariantIds = loadInvariantIds(dir);
  // 重试必须带新信息（审计 #33）：上次写出的 02 还在 = 上次没通过，把它的校验问题交给这次
  const prevErrors = fs.existsSync(specPath)
    ? specErrors(fs.readFileSync(specPath, 'utf8'), input.task_id, intentIds, { invariantIds })
    : [];
  const prompt = loadPrompt('spec', {
    TASK_ID: input.task_id,
    INTENT_PATH: path.join(dir, INTENT_FILE),
    SPEC_PATH: specPath,
    INTENT_IDS: intentIds.join(','),
    INVARIANTS_PATH: path.join(dir, INVARIANTS_FILE),
    PREV_ERRORS: prevErrors.join(' ') || '无',
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

  // 02 不合格当场拦（重试一次让 claude 重写），不留给 build 报 spec_ids_missing（c2afa8ba 实测）
  const errors = specErrors(fs.readFileSync(specPath, 'utf8'), input.task_id, intentIds, { invariantIds });
  if (errors.length > 0) return fail('retryable', 'spec_invalid', { evidence: [{ spec_errors: errors }] });

  return {
    status: 'completed',
    outputs: { spec_file: SPEC_FILE, spec_sha256: sha256File(specPath) },
    evidence: [`${SPEC_FILE} 已生成`],
  };
});
