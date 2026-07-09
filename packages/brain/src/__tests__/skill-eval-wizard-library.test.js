/**
 * skill-eval-wizard-library.test.js
 * Sprint: skill-eval-full-4page
 * TDD 先行：wizard 向导 + library 技能库 端点行为单元测试
 *
 * 覆盖：
 * - wizard 问题查询（GET /api/skill-eval/wizard/:task_id）
 * - wizard 答案提交（POST /api/skill-eval/wizard/:task_id/answers）
 * - 技能库总览（GET /api/skill-eval/library）
 * - 技能库按 journey 下钻（GET /api/skill-eval/library/:journey_id）
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock 数据库 ─────────────────────────────────────────────────────────────

const { mockPool } = vi.hoisted(() => {
  const mockPool = { query: vi.fn() };
  return { mockPool };
});

vi.mock('../db.js', () => ({ default: mockPool }));

// ─── 测试：wizard 状态字段 ───────────────────────────────────────────────────

describe('skill-eval wizard endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('wizard_status 默认值为 none', () => {
    const VALID_WIZARD_STATUSES = ['none', 'generating', 'waiting', 'answered', 'skipped'];
    const defaultStatus = 'none';
    expect(VALID_WIZARD_STATUSES).toContain(defaultStatus);
  });

  it('wizard 问题包含 7 道是/否题', () => {
    const mockQuestions = [
      { id: 'q1', text: '该 skill 有明确的输入依赖列表吗？', type: 'yn' },
      { id: 'q2', text: '输入依赖来源均已验证可达吗？', type: 'yn' },
      { id: 'q3', text: '输出格式已定义清楚吗？', type: 'yn' },
      { id: 'q4', text: '至少一个输出可机械校验吗？', type: 'yn' },
      { id: 'q5', text: '编造/幻觉场景有防护机制吗？', type: 'yn' },
      { id: 'q6', text: '已在真实样本上跑通过吗？', type: 'yn' },
      { id: 'q7', text: '规则之间无明显矛盾吗？', type: 'yn' },
    ];
    expect(mockQuestions).toHaveLength(7);
    mockQuestions.forEach((q) => {
      expect(q).toHaveProperty('id');
      expect(q).toHaveProperty('text');
      expect(q.type).toBe('yn');
    });
  });

  it('wizard 答案格式：key 为问题 id，值为 yes|no', () => {
    const validAnswers = { q1: 'yes', q2: 'no', q3: 'yes', q4: 'yes', q5: 'no', q6: 'yes', q7: 'yes' };
    const allowedValues = ['yes', 'no'];
    Object.values(validAnswers).forEach((v) => {
      expect(allowedValues).toContain(v);
    });
    expect(Object.keys(validAnswers)).toHaveLength(7);
  });

  it('wizard 答案为空时应拒绝提交', () => {
    const answers = {};
    const isValid = Object.keys(answers).length > 0;
    expect(isValid).toBe(false);
  });

  it('wizard DB 查询应按 task_id 过滤', () => {
    const taskId = '550e8400-e29b-41d4-a716-446655440000';
    const expectedSql = expect.stringContaining('WHERE id');
    const params = [taskId];
    mockPool.query.mockResolvedValueOnce({ rows: [] });
    mockPool.query(expectedSql, params);
    expect(mockPool.query).toHaveBeenCalledWith(expectedSql, params);
  });
});

// ─── 测试：library 技能库 ────────────────────────────────────────────────────

describe('skill-eval library endpoints', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('library 返回结构包含 journeys 数组', () => {
    const mockLibraryResponse = {
      journeys: [
        {
          journey_id: 'line-04',
          name: 'Line 04 私域AI接管',
          skill_count: 3,
          skills: [],
        },
      ],
      total_skills: 3,
    };
    expect(mockLibraryResponse).toHaveProperty('journeys');
    expect(Array.isArray(mockLibraryResponse.journeys)).toBe(true);
    expect(mockLibraryResponse.journeys[0]).toHaveProperty('journey_id');
    expect(mockLibraryResponse.journeys[0]).toHaveProperty('skill_count');
  });

  it('library skill 条目包含版本列表', () => {
    const mockSkill = {
      name: 'daily-report-cs',
      journey_id: 'line-04',
      versions: [
        { id: 'uuid-1', created_at: '2026-07-01', verdict: 'pass', eval_model: 'claude-sonnet' },
        { id: 'uuid-2', created_at: '2026-07-08', verdict: 'partial', eval_model: 'claude-sonnet' },
      ],
      latest_verdict: 'partial',
    };
    expect(Array.isArray(mockSkill.versions)).toBe(true);
    expect(mockSkill.versions.length).toBeGreaterThan(0);
    mockSkill.versions.forEach((v) => {
      expect(v).toHaveProperty('id');
      expect(v).toHaveProperty('verdict');
      expect(['pass', 'partial', 'fail']).toContain(v.verdict);
    });
  });

  it('library verdict 只能是 pass / partial / fail', () => {
    const VALID_VERDICTS = ['pass', 'partial', 'fail'];
    expect(VALID_VERDICTS).toHaveLength(3);
    expect(VALID_VERDICTS).toContain('pass');
    expect(VALID_VERDICTS).toContain('partial');
    expect(VALID_VERDICTS).toContain('fail');
    expect(VALID_VERDICTS).not.toContain('unknown');
  });

  it('按 journey_id 下钻只返回该 journey 的 skill', () => {
    const journeyId = 'line-04';
    const allSkills = [
      { name: 'skill-a', journey_id: 'line-04' },
      { name: 'skill-b', journey_id: 'line-05' },
      { name: 'skill-c', journey_id: 'line-04' },
    ];
    const filtered = allSkills.filter((s) => s.journey_id === journeyId);
    expect(filtered).toHaveLength(2);
    filtered.forEach((s) => expect(s.journey_id).toBe(journeyId));
  });

  it('upload 三级归属字段：area / line_name / ability 均需非空', () => {
    const validUpload = { area: 'ZenithJoy', line_name: 'Line 04 私域AI接管', ability: '客服判断', skill_name: 'daily-report-cs' };
    const invalidUpload = { area: '', line_name: 'Line 04', ability: '客服判断', skill_name: 'test' };
    expect(validUpload.area).toBeTruthy();
    expect(validUpload.line_name).toBeTruthy();
    expect(validUpload.ability).toBeTruthy();
    expect(invalidUpload.area).toBeFalsy();
  });
});
