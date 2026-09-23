/**
 * qiumi-source.test.js
 *
 * qiumi_source 原为 notion-push-sync.js:411-416 的内联字面量，抽到中立叶子模块
 * lib/qiumi-source.js 供生产代码与全部消费方（测试/smoke）共同 import。
 * 基线字面量取自抽出前 notion-push-sync-marked-ingest.test.js:63-67 的期望值，
 * 抽模块不改值。
 *
 * 终点是 jsonb：JS 层 toEqual 会忽略"值为 undefined 的多余键"，与落库形状不是
 * 一回事，故基线断言做两层（JS 层 + JSON round-trip 层）。
 */
import { describe, it, expect } from 'vitest';
import { buildQiumiSource, qiumiSourceFromNotion } from '../qiumi-source.js';

// 抽出前 notion-push-sync.js:411-416 对这组输入的真实产出（marked-ingest.test.js:63-67）
const BASELINE = {
  title: '用 Claude Code 把首页按钮改蓝',
  remark: 'opc_department=dev',
  body: '中文正文',
  priority_raw: '高',
  due_at: '2026-09-24T09:00:00.000+08:00',
  channel: null,
  agent_workflow_ids: ['wf-1'],
  skill_ids: [],
  business_task_ids: [],
  owner_ids: ['u-1'],
};

const ZH = {
  remark: 'opc_department=dev',
  priorityRaw: '高',
  channel: null,
  agentWorkflowIds: ['wf-1'],
  skillIds: [],
  businessTaskIds: [],
  ownerIds: ['u-1'],
};

describe('qiumiSourceFromNotion: 抽模块零行为变化', () => {
  it('与抽出前的基线字面量逐键相等（JS 层）', () => {
    const built = qiumiSourceFromNotion({
      title: '用 Claude Code 把首页按钮改蓝',
      zh: ZH,
      en: { description: 'EN 描述' },
      zhBody: '中文正文',
      enBody: 'EN 正文',
      dueAt: '2026-09-24T09:00:00.000+08:00',
    });
    expect(built).toEqual(BASELINE);
  });

  it('JSON round-trip 后仍与基线相等（终点是 jsonb，undefined 键会被丢掉）', () => {
    const built = qiumiSourceFromNotion({
      title: '用 Claude Code 把首页按钮改蓝',
      zh: ZH,
      en: { description: 'EN 描述' },
      zhBody: '中文正文',
      enBody: 'EN 正文',
      dueAt: '2026-09-24T09:00:00.000+08:00',
    });
    expect(JSON.parse(JSON.stringify(built))).toEqual(BASELINE);
  });

  it('remark 用 ??：中文备注为空串时不回落 en.description（plain() 恒返回字符串）', () => {
    const built = qiumiSourceFromNotion({
      title: 'T', zh: { ...ZH, remark: '' }, en: { description: 'EN 描述' },
      zhBody: '中文正文', enBody: 'EN 正文', dueAt: null,
    });
    expect(built.remark).toBe('');
  });

  it('body 用 ||：中文正文为空串时必须回落英文正文', () => {
    const built = qiumiSourceFromNotion({
      title: 'T', zh: ZH, en: { description: 'EN 描述' },
      zhBody: '', enBody: 'EN 正文', dueAt: null,
    });
    expect(built.body).toBe('EN 正文');
  });

  it('zh 为 null（反查不到中文行）不崩，四个 id 数组取 []、remark 回落 en.description', () => {
    const built = qiumiSourceFromNotion({
      title: 'T', zh: null, en: { description: 'EN 描述' },
      zhBody: '', enBody: 'EN 正文', dueAt: null,
    });
    expect(built).toEqual({
      title: 'T', remark: 'EN 描述', body: 'EN 正文',
      priority_raw: null, due_at: null, channel: null,
      agent_workflow_ids: [], skill_ids: [], business_task_ids: [], owner_ids: [],
    });
  });
});

describe('buildQiumiSource: 扁平层', () => {
  it('十个键齐全，未传的 id 数组取 []、可空标量取 null', () => {
    expect(buildQiumiSource({ title: 'T' })).toEqual({
      title: 'T', remark: undefined, body: undefined,
      priority_raw: null, due_at: null, channel: null,
      agent_workflow_ids: [], skill_ids: [], business_task_ids: [], owner_ids: [],
    });
  });

  it('不传任何参数也不崩（消费方只关心部分键的场景）', () => {
    expect(buildQiumiSource()).toMatchObject({ agent_workflow_ids: [], skill_ids: [] });
  });
});
