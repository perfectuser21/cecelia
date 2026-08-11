import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../../..', import.meta.url));
const readSkill = (name) => readFileSync(
  `${repoRoot}/packages/workflows/skills/${name}/SKILL.md`,
  'utf8',
);

describe('Unified Map 制度消费者', () => {
  it('Planner 从 task payload 解析 map_scope/map_repo 并读取统一地图', () => {
    const skill = readSkill('harness-planner');
    expect(skill).toContain('.payload.map_scope');
    expect(skill).toContain('.payload.map_repo');
    expect(skill).toContain('/api/brain/map?scope=${MAP_SCOPE}');
  });

  it('Proposer 用同一 scope/repo 读取地图与影响半径', () => {
    const skill = readSkill('harness-contract-proposer');
    expect(skill).toContain('.payload.map_scope');
    expect(skill).toContain('.payload.map_repo');
    expect(skill).toContain('/api/brain/map?scope=${MAP_SCOPE}');
    expect(skill).toContain('/api/brain/map/radius');
    expect(skill).toContain('must_run_assertions');
  });

  it('capability-mapper 的 Mode 2 只产出完整 Manifest，不直写旧账本', () => {
    const skill = readSkill('capability-mapper');
    const mode2 = skill.slice(skill.indexOf('## Mode 2：'));
    expect(mode2).toContain('新的完整 manifest JSON');
    expect(mode2).not.toMatch(/manifest patch/i);
    expect(mode2).not.toContain('journey_features');
    expect(mode2).not.toContain('写入 golden_paths');
  });
});
