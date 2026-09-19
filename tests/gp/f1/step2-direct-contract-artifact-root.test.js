// F1「工厂 · 开发闭环」步骤 2「合同即法律」—— 边：直配合同（bugfix 快车道）产物根目录 = 任务 sprint_dir
//
// 2026-09-19 run 35c352b3 案卷：hotfix-v1 直配合同把四份产物落在 direct-contracts/<receipt>/
//（含 tests/impact-contract.md），而 runner materialize-frozen-contract-artifacts 只认
// `${sprint_dir}/tests/` 前缀的 frozen_contract_test 与 `${sprint_dir}/` 前缀的文档 →
// invalid frozen test descriptor → generator 每次启动即 frozen_contract_artifacts_invalid 循环，
// 每 90s 烧一次额度；bugfix 类任务在 kernel 里从未跑通，只能人工手停改路径 A。
// 修：产物根目录优先任务 payload.sprint_dir（非法才回退 direct-contracts/<receipt>）。
//
// 真 import 被改模块 direct-profile-contract.js（守卫在边上），不 mock 它。
import { describe, it, expect } from 'vitest';
import { resolveDirectArtifactRoot } from '../../../packages/brain/src/orchestrator/direct-profile-contract.js';

const receipt = { id: '11111111-2222-4333-8444-555555555555' };

describe('F1 step2 · 直配合同产物根目录必须匹配 runner 物化前缀契约', () => {
  it('有合法 sprint_dir → 产物根目录就是它（末尾斜杠剥掉），runner 才认 ${sprint_dir}/tests/', () => {
    expect(resolveDirectArtifactRoot(receipt, 'sprints/09192245-kernel-848e07bf')).toBe('sprints/09192245-kernel-848e07bf');
    expect(resolveDirectArtifactRoot(receipt, 'sprints/09192245-kernel-848e07bf/')).toBe('sprints/09192245-kernel-848e07bf');
  });

  it.each([
    ['缺失', undefined],
    ['null', null],
    ['空串', ''],
    ['绝对路径', '/etc/sprints'],
    ['路径穿越', 'sprints/../x'],
    ['反斜杠', 'sprints\\x'],
    ['空段', 'sprints//x'],
  ])('sprint_dir %s → 回退 direct-contracts/<receipt>（fail-closed 不猜路径）', (_label, bad) => {
    expect(resolveDirectArtifactRoot(receipt, bad)).toBe(`direct-contracts/${receipt.id}`);
  });
});
