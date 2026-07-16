/**
 * Regression test — harness target_environment 枚举必须含 android_realmachine
 *
 * 背景：Path2 安卓获客真机验收（xian-rog）缺 target_environment 路由，Harness
 * planner/evaluator 6 种枚举里没有 android，验收任务无法自动派到安卓真机
 * （decision issue_agent_android_collect_no_realmachine_gate 洞①）。
 *
 * 本测试直接从真实 SKILL.md 里提取枚举/正则，而非硬编码复制一份，
 * 防止"测试自己写死通过、SKILL.md 实际没改"的假绿。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '../../../..');
const PLANNER_SKILL = join(REPO_ROOT, 'packages/workflows/skills/harness-planner/SKILL.md');
const PROPOSER_SKILL = join(REPO_ROOT, 'packages/workflows/skills/harness-contract-proposer/SKILL.md');
const EVALUATOR_SKILL = join(REPO_ROOT, 'packages/workflows/skills/harness-evaluator/SKILL.md');

function readSkill(path: string): string {
  return readFileSync(path, 'utf8');
}

describe('harness target_environment 枚举含 android_realmachine', () => {
  it('planner 发货前机械闸正则接受 android_realmachine（真实跑一遍 grep -qE，不是字符串比对）', () => {
    const skill = readSkill(PLANNER_SKILL);
    const gateLineMatch = skill.match(
      /grep -qE '(\^\(## \)\?target_environment: \([^)]+\)\$)' "\$SPRINT_DIR\/sprint-prd\.md"/
    );
    expect(gateLineMatch, 'planner SKILL.md 里找不到 target_environment 机械闸正则行').not.toBeNull();
    const pattern = gateLineMatch![1];

    // 真实跑一遍这条 grep -qE（而非在 JS 里重新实现正则语义），防止测试和实际 shell 行为漂移
    const { spawnSync } = require('child_process');
    const good = spawnSync('bash', ['-c', `echo '## target_environment: android_realmachine' | grep -qE '${pattern}'`]);
    expect(good.status, 'android_realmachine 应当被机械闸判定为合法枚举').toBe(0);

    const bad = spawnSync('bash', ['-c', `echo '## target_environment: not_a_real_env' | grep -qE '${pattern}'`]);
    expect(bad.status, '非法枚举值应当继续被机械闸拒绝（防止改坏正则变成放行一切）').not.toBe(0);
  });

  it('planner PRD 模板枚举行列出 android_realmachine', () => {
    const skill = readSkill(PLANNER_SKILL);
    expect(skill).toMatch(/## target_environment:.*android_realmachine/);
  });

  it('proposer E2E 模板枚举行列出 android_realmachine', () => {
    const skill = readSkill(PROPOSER_SKILL);
    expect(skill).toMatch(/\*\*target_environment\*\*:.*android_realmachine/);
  });

  it('evaluator TARGET_ENV 说明表 + 路由分支均含 android_realmachine', () => {
    const skill = readSkill(EVALUATOR_SKILL);
    expect(skill).toMatch(/`TARGET_ENV`.*android_realmachine/);
    // 路由分支必须把 android_realmachine 并入 GHA 派发桶（与 windows_wechat 同桶），
    // 否则枚举合法但落不到任何 case，实际执行走 *) 兜底分支静默跑成 local_api。
    expect(skill).toMatch(/windows_cloud\|windows_wechat\|android_realmachine\)/);
    expect(skill).toMatch(/ANDROID_REALMACHINE_WORKFLOW/);
  });
});
