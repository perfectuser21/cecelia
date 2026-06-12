/**
 * b2-reentry-idem.mjs — evaluate 重入幂等的活容器检测行为验证（无外部依赖，CI 可跑）。
 *
 * #3372 配套缺口 B：interrupt() 重入让 evaluate 节点从头重跑 → spawn 在 interrupt 前 → 重起容器
 * （实证 evaluate-ws1-r4 同 4 个）。findLiveEvaluateContainer 查同 (task, fix_round) 是否已有活容器，
 * 有则复用、跳过重 spawn。这里注入 mock execFile 断言：docker ps 命中前缀 → 返回容器名；空 → null。
 */
import { findLiveEvaluateContainer as findLiveEvaluateContainerDefault } from '../../../packages/brain/src/lib/live-container.js';

function assert(cond, msg) {
  if (!cond) { console.error('FAIL: ' + msg); process.exit(1); }
}

const PREFIX = 'harness-evaluate-task123-r4-';

// 1) docker ps 命中同前缀活容器 → 返回该容器名（供复用）
const hit = await findLiveEvaluateContainerDefault(PREFIX, {
  execFile: async () => ({ stdout: `${PREFIX}live9999\n` }),
});
assert(hit === `${PREFIX}live9999`, 'docker ps 命中前缀 → 返回活容器名供复用');

// 2) 无活容器 → null（首次进入，正常 spawn）
const none = await findLiveEvaluateContainerDefault(PREFIX, {
  execFile: async () => ({ stdout: '\n' }),
});
assert(none === null, '无活容器 → 返回 null（正常 spawn）');

// 3) docker 返回别的前缀（不同 round/task）→ 过滤掉，null
const other = await findLiveEvaluateContainerDefault(PREFIX, {
  execFile: async () => ({ stdout: 'harness-evaluate-task123-r0-old\nharness-generate-task123-x\n' }),
});
assert(other === null, '只复用同 (task, fix_round) 前缀的容器，别的 round/类型不算');

console.log('OK');
