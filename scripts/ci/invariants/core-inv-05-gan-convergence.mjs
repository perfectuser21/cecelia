/**
 * CORE-INV-05 — P0 铁律「GAN 收敛守护」防放松断言。
 *
 * 设计背景（memory: harness-gan-design）：GAN 对抗【轮次无上限】是刻意设计——
 * 收敛靠三道硬保护，不靠硬轮数：
 *  - MAX_NO_PUSH_STREAK（≤2）：proposer 连续不 push 即判坏，带原因中止
 *  - MAX_NO_VERDICT_STREAK（≤3）：reviewer 连续无可解析 verdict 即中止
 *  - budgetCap（BUDGET_CAP_USD）：花费硬顶，gan_budget_exceeded 熔断
 *
 * 本脚本断言两个方向都不被破坏：
 *  A. 守护不被放松：常量存在且值 ≤ 设计上限，caps 判定逻辑真在执行；
 *  B. 不被"好心加码"：禁止出现 MAX_GAN_ROUNDS 之类硬轮数上限（加了 = 违反刻意设计决策）。
 *
 * 守卫落点：
 *  - packages/brain/src/orchestrator/constants.js（零依赖，直接 import 断言值）
 *  - packages/brain/src/orchestrator/gates.js caps.*（判定逻辑）
 *  - packages/brain/scripts/coding-workflow/lib/gan.mjs（现役 runner 合同对抗，只守「无硬轮数上限」）
 *  （旧 LangGraph 图 workflows/harness-gan.graph.js 已随 A5 删除，决策 b4adf807）
 *
 * CI 干净环境兼容：node 内建 + 零依赖源文件。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MAX_NO_PUSH_STREAK,
  MAX_NO_VERDICT_STREAK,
  BUDGET_CAP_USD,
} from '../../../packages/brain/src/orchestrator/constants.js';
import { caps } from '../../../packages/brain/src/orchestrator/gates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) {
    console.log(`  PASS ${name}`);
  } else {
    failures += 1;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log('== CORE-INV-05 GAN 收敛守护（streak/budget 硬保护，无硬轮数上限）==');

// A1) orchestrator/constants.js 常量未被放松
check(`constants.MAX_NO_PUSH_STREAK (=${MAX_NO_PUSH_STREAK}) 在 [1,2] 内`,
  Number.isInteger(MAX_NO_PUSH_STREAK) && MAX_NO_PUSH_STREAK >= 1 && MAX_NO_PUSH_STREAK <= 2);
check(`constants.MAX_NO_VERDICT_STREAK (=${MAX_NO_VERDICT_STREAK}) 在 [1,3] 内`,
  Number.isInteger(MAX_NO_VERDICT_STREAK) && MAX_NO_VERDICT_STREAK >= 1 && MAX_NO_VERDICT_STREAK <= 3);
check(`constants.BUDGET_CAP_USD (=${BUDGET_CAP_USD}) 为正有限数`,
  Number.isFinite(BUDGET_CAP_USD) && BUDGET_CAP_USD > 0);

// A2) gates.js caps 判定逻辑真在执行（达到阈值即超限）
check('caps.noPushStreakExceeded(MAX_NO_PUSH_STREAK) === true',
  caps.noPushStreakExceeded(MAX_NO_PUSH_STREAK) === true);
check('caps.noPushStreakExceeded(0) === false', caps.noPushStreakExceeded(0) === false);
check('caps.noVerdictStreakExceeded(MAX_NO_VERDICT_STREAK) === true',
  caps.noVerdictStreakExceeded(MAX_NO_VERDICT_STREAK) === true);
check('caps.budgetExceeded(BUDGET_CAP_USD) === true',
  caps.budgetExceeded(BUDGET_CAP_USD) === true);
check('caps.budgetExceeded(0) === false', caps.budgetExceeded(0) === false);

// B) 禁止硬轮数上限复活：MAX_GAN_ROUNDS（GAN 轮次无上限是刻意设计，加了=违反决策）
const guardedFiles = [
  'packages/brain/scripts/coding-workflow/lib/gan.mjs',
  'packages/brain/src/orchestrator/constants.js',
  'packages/brain/src/orchestrator/gates.js',
];
for (const rel of guardedFiles) {
  const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  check(`${rel} 无 MAX_GAN_ROUNDS 硬轮数上限（刻意设计：轮次无上限）`,
    !/MAX_GAN_ROUNDS/.test(src));
}

if (failures > 0) {
  console.error(`== CORE-INV-05 FAIL（${failures} 项）— 铁律「GAN 收敛守护」被放松/被加码 ==`);
  process.exit(1);
}
console.log('== CORE-INV-05 PASS ==');
