/**
 * handoff-schemas 包内单测（配套 tests/gp/f1/step3-handoff-schema-validation.test.js 的 GP 断言）。
 * GP 那份锁「边」的行为契约；这份锁模块自身的 API 形状与边界值。
 */
import { describe, it, expect } from 'vitest';
import {
  HANDOFF_SCHEMAS,
  STAGE_REQUIRED_HANDOFFS,
  validateHandoffObject,
  validateStageEvidence,
} from '../handoff-schemas.js';

const SHA40 = 'a'.repeat(40);
const UUID = 'cccccccc-0000-4000-8000-000000000009';

describe('handoff-schemas 模块 API', () => {
  it('导出五类交接对象 schema，且集合冻结', () => {
    expect(Object.keys(HANDOFF_SCHEMAS).sort()).toEqual([
      'candidate_coordinates', 'planner_prd_artifact', 'published_pr',
      'seal_coordinates', 'sealed_contract',
    ]);
    expect(Object.isFrozen(HANDOFF_SCHEMAS)).toBe(true);
  });

  it('阶段要求表覆盖 contract/seal/generate/generator-fix/publish', () => {
    expect(STAGE_REQUIRED_HANDOFFS.contract).toEqual(['seal_coordinates']);
    expect(STAGE_REQUIRED_HANDOFFS.seal).toEqual(['sealed_contract']);
    expect(STAGE_REQUIRED_HANDOFFS.generate).toEqual(['candidate_coordinates']);
    expect(STAGE_REQUIRED_HANDOFFS['generator-fix']).toEqual(['candidate_coordinates']);
    expect(STAGE_REQUIRED_HANDOFFS.publish).toEqual(['published_pr']);
  });

  it('分支必须 cp- 前缀（防把 main 当候选分支交接）', () => {
    const base = {
      repo: 'perfectuser21/cecelia', branch: 'main',
      head_sha: SHA40, bridge_run_id: UUID, source_attempt_id: UUID,
    };
    const r = validateHandoffObject('candidate_coordinates', base);
    expect(r.ok).toBe(false);
    expect(r.issues.join()).toMatch(/branch/);
  });

  it('sprint_dir 必须 sprints/ 下（防路径越界）', () => {
    const bad = {
      bridge_run_id: UUID, sprint_dir: '../etc', branch: 'cp-x',
      approved_sha: SHA40, base_sha: SHA40,
    };
    expect(validateHandoffObject('seal_coordinates', bad).ok).toBe(false);
  });

  it('null/undefined/非对象 入参不抛异常，判为不合格', () => {
    for (const bad of [null, undefined, 'str', 42, []]) {
      const r = validateHandoffObject('seal_coordinates', bad);
      expect(r.ok).toBe(false);
      expect(Array.isArray(r.issues)).toBe(true);
    }
  });

  it('validateStageEvidence：evidence 非数组按空处理，不抛异常', () => {
    expect(validateStageEvidence('contract', null).ok).toBe(false);
    expect(validateStageEvidence('cleanup', null).ok).toBe(true);
  });

  it('同类交接件出现多条时逐条校验，有一条坏即整体不合格', () => {
    const good = {
      type: 'candidate_coordinates', repo: 'perfectuser21/cecelia', branch: 'cp-x',
      head_sha: SHA40, bridge_run_id: UUID, source_attempt_id: UUID,
    };
    const bad = { ...good, head_sha: 'zzz' };
    expect(validateStageEvidence('generate', [good]).ok).toBe(true);
    expect(validateStageEvidence('generate', [good, bad]).ok).toBe(false);
  });
});
