// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：封印完整性 ↔ repo 路径行 BEHAVIOR
//
// 2026-08-22 生产实证（r50 run a998d588，r45 族第 3 变体）：合同 Test Contract 表
// 的 repo 既有路径行（packages/...）BEHAVIOR 为散文措辞（省略号+中文），无法子串
// 匹配真实 it() 名；seal 校验只查 sprints/ 前缀行（repo 行当时定为"CI 照管"）→
// CI「Test Contract 覆盖检查」红的唯一修法在冻结 contract-draft → 守卫正确拒 →
// generator-fix 三连死（连续三次都只能试图改冻结文档）。
// 修法：assertTestContractResolvable 注入 readRepoFile 时对 repo 行也做
// BEHAVIOR↔it() 匹配（同一把尺提前到合同可改时点）；文件读不到 → 拒（登记了
// 不存在的 repo 测试）；未注入 readRepoFile → 保持现行为（零回归兜底）。
import { describe, expect, it } from 'vitest';
import { assertTestContractResolvable } from '../../../packages/brain/src/orchestrator/contract-test-paths-seal.js';

const SPRINT = 'sprints/08221948-kernel-x';
const REPO_TEST = 'packages/brain/src/orchestrator/validation-clock.test.js';

const ARTIFACTS = [
  { path: `${SPRINT}/contract-draft.md`, content: 'x' },
  { path: `${SPRINT}/tests/window.test.js`, content: "it('window extends per fix round', () => {})" },
];

function table(repoBehavior) {
  return `## Test Contract
| 功能 | Test File | BEHAVIOR | 红证据 |
|---|---|---|---|
| w | \`${SPRINT}/tests/window.test.js\` | \`window extends\` | FAIL |
| r | \`${REPO_TEST}\` | \`${repoBehavior}\` | FAIL |
`;
}

const readRepoFile = (p) => {
  if (p === REPO_TEST) return "it('resolveValidationClock extends deadline per fix round', () => {})";
  throw new Error(`missing ${p}`);
};

describe('F1 step3：seal 对 repo 路径行也校验 BEHAVIOR↔it（r50 案卷）', () => {
  it('repo 行 BEHAVIOR 散文措辞无法匹配 it() 名 → 拒封印（r50 死锁复现）', () => {
    expect(() => assertTestContractResolvable(
      table('多轮 fix 后……窗口按轮数顺延（散文描述）'),
      ARTIFACTS,
      { readRepoFile },
    )).toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_/);
  });

  it('repo 行 BEHAVIOR 与 it() 名互为子串 → 放行', () => {
    expect(() => assertTestContractResolvable(
      table('extends deadline per fix round'),
      ARTIFACTS,
      { readRepoFile },
    )).not.toThrow();
  });

  it('repo 行登记不存在的文件 → 拒封印', () => {
    const t = `## Test Contract
| 功能 | Test File | BEHAVIOR | 红证据 |
|---|---|---|---|
| w | \`${SPRINT}/tests/window.test.js\` | \`window extends\` | FAIL |
| r | \`packages/brain/src/ghost.test.js\` | \`x\` | FAIL |
`;
    expect(() => assertTestContractResolvable(t, ARTIFACTS, { readRepoFile }))
      .toThrow(/FROZEN_CONTRACT_TEST_CONTRACT_/);
  });

  it('未注入 readRepoFile → repo 行跳过（现行为零回归兜底）', () => {
    expect(() => assertTestContractResolvable(
      table('任意散文措辞也不拦'),
      ARTIFACTS,
    )).not.toThrow();
  });
});
