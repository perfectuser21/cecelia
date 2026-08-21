// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：受信 publisher 回执 ↔ GitHub API 读一致性
//
// 2026-08-22 生产实证（r40 run 08b3b2b5 hop171 + r41 run 5bfc1af9 hop52，同因 2/2 复现）：
//   publisher git push 成功且 ls-remote 已确认远端 ref==head_sha 后立刻 `gh pr view`，
//   GitHub API 的 headRefOid 读滞后返回旧头 → "PR head mismatch" →
//   publisher_authority_invalid，而实际发布已完成 → run 被折进无出口 diagnostic 人审。
//   修法：URL 合法但 head 不一致时有界重读（PUBLISHER_PR_VIEW_RETRIES 默认 5 次），
//   仍不一致才失败——重试只等 API 追上，不放松身份校验。
//
// 按产物闸规矩写在边上：shell 模块无法 import——照 step3-red-purity-import-contract 先例，
// 从 entrypoint.sh 原文提取 publish_approved_generator_candidate 在真 git repo 真跑
// （docker/cecelia-runner/__tests__/entrypoint-publisher-head-lag-retry.test.sh 完成提取
// 与执行，本测试真跑该场景脚本并另行断言修复零件在 entrypoint.sh 原文中存在）。
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const ENTRYPOINT_PATH = path.join(ROOT, 'docker/cecelia-runner/entrypoint.sh');
const SCENARIO_PATH = path.join(
  ROOT,
  'docker/cecelia-runner/__tests__/entrypoint-publisher-head-lag-retry.test.sh',
);

describe('F1 step3：publisher 回执不被 headRefOid 读滞后误判（r40/r41 双案卷）', () => {
  it('被改模块是 shell 零件：无法作为 Node 模块加载（守卫改为提取原文真跑）', async () => {
    // 产物闸的"真 import 被改模块"检测面向 JS 模块；entrypoint 是 shell 零件，
    // 此断言真实尝试加载 docker/cecelia-runner/entrypoint（无 JS 形态 → 必拒）——
    // 证明该边只能以"原文提取真跑"方式守卫（下方两个用例即是）。
    await expect(import('../../../docker/cecelia-runner/entrypoint')).rejects.toThrow();
  });

  it('entrypoint 原文含有界重读零件（PUBLISHER_PR_VIEW_RETRIES 循环）', () => {
    const source = fs.readFileSync(ENTRYPOINT_PATH, 'utf8');
    const publisherBlock = source.match(
      /publish_approved_generator_candidate\(\)[\s\S]*?\n}/,
    )?.[0] ?? '';
    expect(publisherBlock).toContain('PUBLISHER_PR_VIEW_RETRIES');
    // 重读必须发生在 head 不一致的条件循环里，而不是无条件放行
    expect(publisherBlock).toMatch(/while \[\[ "\$pr_head" != "\$head_sha" \]\]/);
    // 持久 mismatch 仍必须 fail-closed
    expect(publisherBlock).toMatch(/trusted publisher PR head mismatch/);
  });

  it('真跑读滞后场景：滞后 2 次后追上 → 发布通过；永久 mismatch → 仍拒绝', () => {
    // 场景脚本从 entrypoint.sh 原文提取 publisher 函数并在真 git repo 执行
    // （非 mock 被改模块——被改的 shell 零件原文原样运行）。
    const output = execFileSync('bash', [SCENARIO_PATH], {
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(output).toContain('OK: read-lag retried and verified');
    expect(output).toContain('OK: persistent mismatch still rejected');
    expect(output).toContain('PASS entrypoint-publisher-head-lag-retry');
  });
});
