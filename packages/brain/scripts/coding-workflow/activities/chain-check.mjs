// chain_check 活动：校验 <sprint_dir> 下 md 链（task_id/step 一致、upstream 锚点真实存在且覆盖上游）。
// 应存在的链文件取自上下文 intent_file/spec_file/review_file/build_file/evidence_file；都没有时按只有 01/02 的旧链校验。
import { runActivity, validateBase, fail } from '../lib/protocol.mjs';
import { checkChain } from '../lib/md-chain.mjs';

const CONTEXT_KEYS = ['intent_file', 'spec_file', 'review_file', 'build_file', 'evidence_file'];

await runActivity(async (input) => {
  // 校验失败直接抛错，由 runActivity 转成 failed/fatal（task_id_missing / sprint_dir_invalid）
  const { dir } = validateBase(input);
  const taskId = input.task_id;

  const declared = CONTEXT_KEYS.map((k) => input[k]).filter((f) => typeof f === 'string' && f !== '');
  const { ok, errors, files } = checkChain({ dir, taskId, ...(declared.length > 0 ? { files: declared } : {}) });
  if (!ok) {
    return fail('fatal', 'md_chain_invalid', { evidence: [{ errors }] });
  }
  return { status: 'completed', outputs: { chain_files: files } };
});
