// chain_check 活动：校验 <sprint_dir> 下 md 链（task_id 一致、upstream 锚点真实存在）。
import { runActivity, resolveSprintDir } from '../lib/protocol.mjs';
import { checkChain } from '../lib/md-chain.mjs';

await runActivity(async (input) => {
  const { task_id: taskId, worktree, sprint_dir: sprintDir } = input;
  // 非法目录直接抛错，由 runActivity 转成 failed/fatal（reason_code=sprint_dir_invalid）
  const dir = resolveSprintDir(worktree, sprintDir);

  const { ok, errors, files } = checkChain({ dir, taskId });
  if (!ok) {
    return {
      status: 'failed',
      failure_class: 'fatal',
      reason_code: 'md_chain_invalid',
      evidence: [{ errors }],
    };
  }
  return { status: 'completed', outputs: { chain_files: files } };
});
