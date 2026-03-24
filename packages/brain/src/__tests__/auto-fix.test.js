/**
 * auto-fix.js 单元测试
 * 覆盖所有导出函数：shouldAutoFix, generateFixPrd, dispatchToDevSkill, getAutoFixStats
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

// Mock pg pool — hoisted
const mockQuery = vi.hoisted(() => vi.fn());
vi.mock('../db.js', () => ({ default: { query: mockQuery } }));

// Mock actions.js createTask — hoisted
const mockCreateTask = vi.hoisted(() => vi.fn());
vi.mock('../actions.js', () => ({ createTask: mockCreateTask }));

// isolate:false 修复：不在顶层 await import，改为 beforeAll + vi.resetModules()
let shouldAutoFix, generateFixPrd, dispatchToDevSkill, getAutoFixStats;

beforeAll(async () => {
  vi.resetModules();
  const mod = await import('../auto-fix.js');
  shouldAutoFix = mod.shouldAutoFix;
  generateFixPrd = mod.generateFixPrd;
  dispatchToDevSkill = mod.dispatchToDevSkill;
  getAutoFixStats = mod.getAutoFixStats;
});

describe('auto-fix.js', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ========== shouldAutoFix ==========
  describe('shouldAutoFix', () => {
    it('信心度 > 0.7 且 proposed_fix 具体时返回 true', () => {
      const result = shouldAutoFix({
        confidence: 0.85,
        proposed_fix: 'Refactor the retry logic to add exponential backoff with jitter'
      });
      expect(result).toBe(true);
    });

    it('信心度恰好等于 0.7 时返回 true（>= 0.7 通过，code: confidence < 0.7）', () => {
      const result = shouldAutoFix({
        confidence: 0.7,
        proposed_fix: 'Refactor the retry logic to add exponential backoff with jitter'
      });
      expect(result).toBe(true);
    });

    it('信心度 < 0.7 时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0.5,
        proposed_fix: 'Fix the null pointer exception in the task dispatcher'
      });
      expect(result).toBe(false);
    });

    it('信心度为 0 时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0,
        proposed_fix: 'Fix the null pointer exception in the task dispatcher'
      });
      expect(result).toBe(false);
    });

    it('proposed_fix 为空字符串时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0.9,
        proposed_fix: ''
      });
      expect(result).toBe(false);
    });

    it('proposed_fix 少于 20 个字符时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0.9,
        proposed_fix: 'Too short fix'
      });
      expect(result).toBe(false);
    });

    it('proposed_fix 包含 "need more" 关键词时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0.9,
        proposed_fix: 'Need more information to determine the root cause of the issue'
      });
      expect(result).toBe(false);
    });

    it('proposed_fix 包含 "need additional" 时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0.95,
        proposed_fix: 'Need additional investigation to find the proper fix for this error'
      });
      expect(result).toBe(false);
    });

    it('proposed_fix 包含 "cannot determine" 时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0.95,
        proposed_fix: 'Cannot determine the exact fix without more context from the logs'
      });
      expect(result).toBe(false);
    });

    it('proposed_fix 包含 "unclear" 时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0.95,
        proposed_fix: 'The root cause is unclear based on available evidence and logs'
      });
      expect(result).toBe(false);
    });

    it('proposed_fix 包含 "insufficient evidence" 时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0.95,
        proposed_fix: 'There is insufficient evidence to propose a concrete fix here'
      });
      expect(result).toBe(false);
    });

    it('proposed_fix 包含 "more investigation" 时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0.95,
        proposed_fix: 'Requires more investigation before implementing any changes to code'
      });
      expect(result).toBe(false);
    });

    it('关键词匹配不区分大小写', () => {
      const result = shouldAutoFix({
        confidence: 0.9,
        proposed_fix: 'NEED MORE detailed analysis before we can proceed with the fix'
      });
      expect(result).toBe(false);
    });

    it('rcaResult 为 null 时返回 false', () => {
      const result = shouldAutoFix(null);
      expect(result).toBe(false);
    });

    it('rcaResult 为 undefined 时返回 false', () => {
      const result = shouldAutoFix(undefined);
      expect(result).toBe(false);
    });

    it('rcaResult.confidence 不是数字时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 'high',
        proposed_fix: 'Fix the null pointer exception in the task dispatcher module'
      });
      expect(result).toBe(false);
    });

    it('rcaResult.confidence 为 null 时返回 false', () => {
      const result = shouldAutoFix({
        confidence: null,
        proposed_fix: 'Fix the null pointer exception in the task dispatcher module'
      });
      expect(result).toBe(false);
    });

    it('proposed_fix 恰好 20 个字符时返回 true（>= 20 通过，code: length < 20）', () => {
      const result = shouldAutoFix({
        confidence: 0.9,
        proposed_fix: '12345678901234567890'
      });
      expect(result).toBe(true);
    });

    it('proposed_fix 为 21 个字符时通过长度检查', () => {
      const result = shouldAutoFix({
        confidence: 0.9,
        proposed_fix: '123456789012345678901'
      });
      expect(result).toBe(true);
    });

    it('proposed_fix 为 null 时返回 false', () => {
      const result = shouldAutoFix({
        confidence: 0.9,
        proposed_fix: null
      });
      expect(result).toBe(false);
    });

    it('信心度 1.0（最高信心）且 proposed_fix 具体返回 true', () => {
      const result = shouldAutoFix({
        confidence: 1.0,
        proposed_fix: 'Add null check before accessing the task object in executor.js'
      });
      expect(result).toBe(true);
    });
  });

  // ========== generateFixPrd ==========
  describe('generateFixPrd', () => {
    const baseFailure = {
      reason_code: 'TASK_TIMEOUT',
      layer: 'executor',
      step_name: 'dispatch',
      task_id: 'task-123',
      run_id: 'run-456'
    };

    const baseRca = {
      confidence: 0.85,
      root_cause: 'The task executor timed out due to missing retry logic',
      proposed_fix: 'Add exponential backoff retry in executor.js dispatchTask function',
      action_plan: '1. Add retry wrapper\n2. Set max retries to 3\n3. Test with mock',
      evidence: 'Log shows timeout at 30s mark for 5 consecutive runs'
    };

    it('返回字符串类型', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(typeof result).toBe('string');
    });

    it('PRD 包含 reason_code', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('TASK_TIMEOUT');
    });

    it('PRD 包含 layer 信息', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('executor');
    });

    it('PRD 包含 step_name 信息', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('dispatch');
    });

    it('PRD 包含 task_id', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('task-123');
    });

    it('PRD 包含 run_id', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('run-456');
    });

    it('PRD 包含 root_cause', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('The task executor timed out due to missing retry logic');
    });

    it('PRD 包含 proposed_fix', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('Add exponential backoff retry in executor.js dispatchTask function');
    });

    it('PRD 包含 action_plan', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('1. Add retry wrapper');
    });

    it('PRD 包含 evidence', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('Log shows timeout at 30s mark for 5 consecutive runs');
    });

    it('PRD 包含信心度百分比', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('85%');
    });

    it('PRD 包含 Acceptance Criteria 章节', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('Acceptance Criteria');
    });

    it('PRD 包含 CI + DevGate 全绿要求', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('CI');
    });

    it('failure 字段为空对象时使用默认值 UNKNOWN', () => {
      const result = generateFixPrd({}, baseRca);
      expect(result).toContain('UNKNOWN');
    });

    it('failure.reason_code 缺失时标题回退到 System Failure', () => {
      const result = generateFixPrd({}, baseRca);
      expect(result).toContain('System Failure');
    });

    it('failure.layer 缺失时显示 N/A', () => {
      const result = generateFixPrd({ reason_code: 'ERR' }, baseRca);
      expect(result).toContain('N/A');
    });

    it('rcaResult.evidence 缺失时显示 N/A', () => {
      const rcaNoEvidence = { ...baseRca, evidence: undefined };
      const result = generateFixPrd(baseFailure, rcaNoEvidence);
      expect(result).toContain('N/A');
    });

    it('rcaResult.root_cause 缺失时显示 N/A', () => {
      const rcaNoRootCause = { ...baseRca, root_cause: undefined };
      const result = generateFixPrd(baseFailure, rcaNoRootCause);
      expect(result).toContain('N/A');
    });

    it('confidence 0.9 时显示 90%', () => {
      const rca = { ...baseRca, confidence: 0.9 };
      const result = generateFixPrd(baseFailure, rca);
      expect(result).toContain('90%');
    });

    it('PRD 包含自动派发标记说明', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('自动派发');
    });

    it('PRD 包含证据要求章节', () => {
      const result = generateFixPrd(baseFailure, baseRca);
      expect(result).toContain('Evidence Required');
    });
  });

  // ========== dispatchToDevSkill ==========
  describe('dispatchToDevSkill', () => {
    const baseFailure = {
      reason_code: 'TASK_TIMEOUT',
      layer: 'executor',
      step_name: 'dispatch',
      task_id: 'task-123',
      run_id: 'run-456'
    };

    const baseRca = {
      confidence: 0.85,
      root_cause: 'Timeout in executor',
      proposed_fix: 'Add exponential backoff to the dispatch retry mechanism',
      action_plan: 'Implement retry with jitter',
      evidence: 'Multiple timeout logs'
    };

    // Guard query: 默认返回 0（未超限），让每个测试都能正常到达 createTask
    beforeEach(() => {
      mockQuery.mockResolvedValueOnce({ rows: [{ cnt: '0' }] });
    });

    it('正常派发：createTask 被调用一次', async () => {
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-new' } });

      await dispatchToDevSkill(baseFailure, baseRca, 'sig-abc');

      expect(mockCreateTask).toHaveBeenCalledTimes(1);
    });

    it('正常派发：createTask 接收正确的 title（含 signature）', async () => {
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-new' } });

      await dispatchToDevSkill(baseFailure, baseRca, 'sig-abc');

      const callArg = mockCreateTask.mock.calls[0][0];
      expect(callArg.title).toContain('Auto-Fix');
      expect(callArg.title).toContain('TASK_TIMEOUT');
      expect(callArg.title).toContain('sig-abc');
    });

    it('正常派发：task_type 为 dev', async () => {
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-new' } });

      await dispatchToDevSkill(baseFailure, baseRca, 'sig-abc');

      const callArg = mockCreateTask.mock.calls[0][0];
      expect(callArg.task_type).toBe('dev');
    });

    it('正常派发：priority 为 P1', async () => {
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-new' } });

      await dispatchToDevSkill(baseFailure, baseRca, 'sig-abc');

      const callArg = mockCreateTask.mock.calls[0][0];
      expect(callArg.priority).toBe('P1');
    });

    it('正常派发：skill 为 /dev', async () => {
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-new' } });

      await dispatchToDevSkill(baseFailure, baseRca, 'sig-abc');

      const callArg = mockCreateTask.mock.calls[0][0];
      expect(callArg.skill).toBe('/dev');
    });

    it('正常派发：status 为 queued', async () => {
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-new' } });

      await dispatchToDevSkill(baseFailure, baseRca, 'sig-abc');

      const callArg = mockCreateTask.mock.calls[0][0];
      expect(callArg.status).toBe('queued');
    });

    it('正常派发：tags 包含 auto-fix、rca 和 signature', async () => {
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-new' } });

      await dispatchToDevSkill(baseFailure, baseRca, 'sig-xyz');

      const callArg = mockCreateTask.mock.calls[0][0];
      const tags = JSON.parse(callArg.tags);
      expect(tags).toContain('auto-fix');
      expect(tags).toContain('rca');
      expect(tags).toContain('sig-xyz');
    });

    it('正常派发：description 包含 PRD 内容', async () => {
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-new' } });

      await dispatchToDevSkill(baseFailure, baseRca, 'sig-abc');

      const callArg = mockCreateTask.mock.calls[0][0];
      expect(callArg.description).toContain('Auto-Fix');
      expect(callArg.description).toContain('TASK_TIMEOUT');
    });

    it('正常派发：prd_content 与 description 相同', async () => {
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-new' } });

      await dispatchToDevSkill(baseFailure, baseRca, 'sig-abc');

      const callArg = mockCreateTask.mock.calls[0][0];
      expect(callArg.prd_content).toBe(callArg.description);
    });

    it('正常派发：返回 createTask 的返回值', async () => {
      const fakeReturn = { success: true, task: { id: 'task-new' } };
      mockCreateTask.mockResolvedValueOnce(fakeReturn);

      const result = await dispatchToDevSkill(baseFailure, baseRca, 'sig-abc');

      expect(result).toEqual(fakeReturn);
    });

    it('failure.reason_code 缺失时 title 回退到 System Failure', async () => {
      mockCreateTask.mockResolvedValueOnce({ success: true, task: { id: 'task-nrc' } });

      await dispatchToDevSkill({}, baseRca, 'sig-nrc');

      const callArg = mockCreateTask.mock.calls[0][0];
      expect(callArg.title).toContain('System Failure');
    });

    it('createTask 抛出异常时 dispatchToDevSkill 也抛出', async () => {
      mockCreateTask.mockRejectedValueOnce(new Error('DB connection failed'));

      await expect(
        dispatchToDevSkill(baseFailure, baseRca, 'sig-err')
      ).rejects.toThrow('DB connection failed');
    });
  });

  // ========== getAutoFixStats ==========
  describe('getAutoFixStats', () => {
    it('正常返回统计数据', async () => {
      const fakeStats = {
        total_auto_fixes: '5',
        completed_fixes: '3',
        failed_fixes: '1',
        in_progress_fixes: '0',
        queued_fixes: '1'
      };
      mockQuery.mockResolvedValueOnce({ rows: [fakeStats] });

      const result = await getAutoFixStats();

      expect(result).toEqual(fakeStats);
    });

    it('SQL 查询 tasks 表并过滤 auto-fix 标签', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await getAutoFixStats();

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('tasks');
      expect(sql).toContain('auto-fix');
    });

    it('SQL 使用 jsonb ? 操作符', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await getAutoFixStats();

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('?');
    });

    it('SQL 包含 COUNT(*) 聚合', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await getAutoFixStats();

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('COUNT(*)');
    });

    it('SQL 包含按 status 分组的 FILTER 条件', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await getAutoFixStats();

      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('completed');
      expect(sql).toContain('failed');
      expect(sql).toContain('in_progress');
      expect(sql).toContain('queued');
    });

    it('所有 fix 数量为 0 时正常返回', async () => {
      const emptyStats = {
        total_auto_fixes: '0',
        completed_fixes: '0',
        failed_fixes: '0',
        in_progress_fixes: '0',
        queued_fixes: '0'
      };
      mockQuery.mockResolvedValueOnce({ rows: [emptyStats] });

      const result = await getAutoFixStats();

      expect(result.total_auto_fixes).toBe('0');
    });

    it('pool.query 被调用一次', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{}] });

      await getAutoFixStats();

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('pool.query 失败时抛出异常', async () => {
      mockQuery.mockRejectedValueOnce(new Error('Connection timeout'));

      await expect(getAutoFixStats()).rejects.toThrow('Connection timeout');
    });
  });
});
