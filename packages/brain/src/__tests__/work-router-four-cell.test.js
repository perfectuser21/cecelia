/**
 * work-router-four-cell.test.js — Crystal 件1:四格路由器回归测试(RED 先行)
 *
 * 两轴四格(决策 ca9f3d7b/28ca1f69):
 *   轴1 artifact_kind: code(交付=PR) | execution(交付=run)
 *   轴2 answer_known:  true(答案说得出) | false(先跑一遍)
 *
 * 案卷:09-05/06 九件 meta/execution 类工作全被塞进 kernel 线,被三种确定性杀手
 * (impact_anchor_missing / validation_clock_required / 装配层)绞杀 0/7。
 * 核心回归断言:execution 类工作**永不**路由进 kernel-harness-v2。
 */
import { describe, it, expect } from 'vitest';
import {
  classifyArtifactKind,
  classifyAnswerKnown,
  selectPipeline,
  routeWork,
} from '../work-router.js';

const base = {
  declared_change_kind: 'capability_change',
  source: 'api',
  source_id: 'test-1',
  title: 't',
  mutation_intent: 'write',
  change_kind: 'capability_change',
  repo_hint: 'cecelia',
};
const FACTS = [{ repo: 'cecelia', path: null, aliases: [] }];

describe('classifyArtifactKind(轴1)', () => {
  it('显式声明优先且校验:非法值抛 invalid_artifact_kind', () => {
    expect(classifyArtifactKind({ ...base, artifact_kind: 'execution' })).toBe('execution');
    expect(classifyArtifactKind({ ...base, artifact_kind: 'code' })).toBe('code');
    expect(() => classifyArtifactKind({ ...base, artifact_kind: 'bogus' })).toThrow('invalid_artifact_kind');
  });
  it('租户/设备/画布标记 → execution', () => {
    expect(classifyArtifactKind({ ...base, payload: { tenant_id: 'jino' } })).toBe('execution');
    expect(classifyArtifactKind({ ...base, payload: { device_id: 'MAA-AN00' } })).toBe('execution');
    expect(classifyArtifactKind({ ...base, payload: { canvas: 'AwrSocialLeadgenV4' } })).toBe('execution');
    expect(classifyArtifactKind({ ...base, payload: { workflow: 'leadgen' } })).toBe('execution');
  });
  it('repo/分支标记(无执行标记)→ code;默认 code', () => {
    expect(classifyArtifactKind({ ...base, payload: { base_repo: 'https://github.com/x/y' } })).toBe('code');
    expect(classifyArtifactKind({ ...base, payload: {} })).toBe('code');
  });
  it('显式 > 标记:payload 有 tenant 但显式 code → code', () => {
    expect(classifyArtifactKind({ ...base, artifact_kind: 'code', payload: { tenant_id: 'j' } })).toBe('code');
  });
});

describe('classifyAnswerKnown(轴2)', () => {
  it('显式布尔优先', () => {
    expect(classifyAnswerKnown({ ...base, answer_known: false })).toBe(false);
    expect(classifyAnswerKnown({ ...base, answer_known: true })).toBe(true);
  });
  it('bugfix/param 类默认 known(答案已诊断)', () => {
    expect(classifyAnswerKnown({ ...base, change_kind: 'bugfix' })).toBe(true);
  });
  it('描述含探索词(探索/调研/spike/先跑/不知道)→ false', () => {
    for (const d of ['先探索一下方案', '调研可行性', 'spike: try approach', '先跑一遍看看', '还不知道怎么做']) {
      expect(classifyAnswerKnown({ ...base, description: d })).toBe(false);
    }
  });
  it('默认 true(常规明确工作)', () => {
    expect(classifyAnswerKnown({ ...base, description: '加一个字段' })).toBe(true);
  });
});

describe('selectPipeline 四格路由', () => {
  it('【核心回归】execution 类永不进 kernel-harness-v2(meta 三杀手案卷)', () => {
    const d = selectPipeline({
      work_kind: 'coding_mutation', change_kind: 'new_capability',
      artifact_kind: 'execution', answer_known: false,
    });
    expect(d.orchestrator).not.toBe('kernel-harness-v2');
    expect(d.pipeline).toBe('canvas');
    expect(d.canonical_task_type).toBe('exploratory');
    expect(d.impact_contract_required).toBe(false);
    expect(d.artifact_kind).toBe('execution');
  });
  it('execution+known 同样走 canvas 线(直接建画布+skill)', () => {
    const d = selectPipeline({
      work_kind: 'coding_mutation', change_kind: 'capability_change',
      artifact_kind: 'execution', answer_known: true,
    });
    expect(d.pipeline).toBe('canvas');
    expect(d.answer_known).toBe(true);
  });
  it('code 类走原线不变(harness/kernel),四格字段随行留痕', () => {
    const d = selectPipeline({
      work_kind: 'coding_mutation', change_kind: 'bugfix',
      artifact_kind: 'code', answer_known: true,
    });
    expect(d.pipeline).toBe('harness');
    expect(d.orchestrator).toBe('kernel-harness-v2');
    expect(d.artifact_kind).toBe('code');
    expect(d.answer_known).toBe(true);
  });
  it('code 类缺 change_kind 仍抛 change_kind_required(老契约不破)', () => {
    expect(() => selectPipeline({ work_kind: 'coding_mutation', artifact_kind: 'code' }))
      .toThrow('change_kind_required');
  });
});

describe('routeWork 端到端携带四格', () => {
  it('execution 请求:决策带两轴,repo 不强制解析', () => {
    const d = routeWork({
      ...base, declared_change_kind: 'new_capability',
      payload: { tenant_id: 'jino', device_id: 'x' },
      map_scope_hint: ['F1'],
    }, FACTS);
    expect(d.artifact_kind).toBe('execution');
    expect(d.pipeline).toBe('canvas');
  });
  it('code 请求:决策带两轴,原路由字段齐全', () => {
    const d = routeWork({ ...base, map_scope_hint: ['F1'] }, FACTS);
    expect(d.artifact_kind).toBe('code');
    expect(d.answer_known).toBe(true);
    expect(d.pipeline).toBe('harness');
    expect(d.repo).toBe('cecelia');
  });
});
