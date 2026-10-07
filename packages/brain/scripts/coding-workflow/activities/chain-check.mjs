// chain_check 活动：校验 <sprint_dir> 下 md 链（task_id 一致、upstream 锚点真实存在）。
import { runActivity, validateBase, fail } from '../lib/protocol.mjs';
import { checkChain } from '../lib/md-chain.mjs';

await runActivity(async (input) => {
  // 校验失败直接抛错，由 runActivity 转成 failed/fatal（task_id_missing / sprint_dir_invalid）
  const { dir } = validateBase(input);
  const taskId = input.task_id;

  const { ok, errors, files } = checkChain({ dir, taskId });
  if (!ok) {
    return fail('fatal', 'md_chain_invalid', { evidence: [{ errors }] });
  }
  return { status: 'completed', outputs: { chain_files: files } };
});
