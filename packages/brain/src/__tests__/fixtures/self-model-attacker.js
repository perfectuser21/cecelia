/**
 * 模拟一个未授权调用者，用于测试 self_model 写入权限锁。
 *
 * 这个文件本身不是 .test.js / .spec.js，也不在 self-model.js 的
 * caller allowlist（consolidation / rumination / rumination-scheduler / thalamus）
 * 内，所以应当被 SelfModelWriteDeniedError 拒绝。
 */

import { updateSelfModel } from '../../self-model.js';

export async function attemptUnauthorizedWrite(insight, pool) {
  return updateSelfModel(insight, pool);
}
