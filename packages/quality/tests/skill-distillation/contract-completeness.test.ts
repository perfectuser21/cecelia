// 用例④：契约完备性 lint —— 每技能必须声明 pre + post + side_effects
// 「没探针不许固化」的机械化（决策 28ca1f69 蒸馏五步循环）：
// 无 precondition → 环境时序失败会被误判成定位失败（09-05 B 臂唯一失败即此）
// 无 postcondition → 执行者自证不可信（A 臂 doneClaimed 停在桌面）
// 未声明 side_effects → 技能不可安全重试/组合
import { describe, it, expect } from 'vitest';
import { SKILLS } from '../../skill-distillation/src/contracts.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const skillNames = Object.keys(SKILLS);

describe('契约完备性 lint', () => {
  it('契约表非空（至少 search_account 已固化）', () => {
    expect(skillNames).toContain('search_account');
  });

  describe.each(skillNames)('技能 %s', (name) => {
    const skill = (SKILLS as any)[name];

    it('preconditions 存在且非空', () => {
      expect(Array.isArray(skill.preconditions)).toBe(true);
      expect(skill.preconditions.length).toBeGreaterThan(0);
      for (const p of skill.preconditions) expect(p.type).toBeTruthy();
    });

    it('postconditions 存在且非空（无探针不许固化）', () => {
      expect(Array.isArray(skill.postconditions)).toBe(true);
      expect(skill.postconditions.length).toBeGreaterThan(0);
      for (const p of skill.postconditions) expect(p.type).toBeTruthy();
    });

    it('side_effects 显式声明（数组，可空但必须存在）', () => {
      expect(Array.isArray(skill.side_effects)).toBe(true);
    });

    it('sequence 存在、非空、且不含任何具体坐标（坐标只许在 registry）', () => {
      expect(Array.isArray(skill.sequence)).toBe(true);
      expect(skill.sequence.length).toBeGreaterThan(0);
      for (const step of skill.sequence) {
        expect(step.x).toBeUndefined();
        expect(step.y).toBeUndefined();
      }
    });
  });

  it('金标集 manifest 的 judge 在契约 postconditions 里被引用（金标守护的就是真实验收判定器）', () => {
    const manifestPath = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../skill-distillation/goldset/manifest.json'
    );
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const judges = Object.values(SKILLS).flatMap((s: any) =>
      s.postconditions.filter((p: any) => p.type === 'vision_judge').map((p: any) => p.judge)
    );
    expect(judges).toContain(manifest.judge);
    expect(manifest.samples.length).toBeGreaterThanOrEqual(10);
    const trueSamples = manifest.samples.filter((s: any) => s.expected === true);
    const falseSamples = manifest.samples.filter((s: any) => s.expected === false);
    expect(trueSamples.length).toBeGreaterThanOrEqual(2);
    expect(falseSamples.length).toBeGreaterThanOrEqual(4);
  });
});
