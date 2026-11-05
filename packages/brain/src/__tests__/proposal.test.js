// Canonical proposal contract; grouped without copying product implementations.
import { describe, it, expect, beforeEach } from 'vitest';
import { resetProposalMocks, mockQuery } from './helpers/proposal-fixture.js';
const { validateChange, validateChanges, hasCycleInGraph, detectCycle, checkRateLimit, BULK_THRESHOLD } = await import('../proposal.js');
describe('proposal', () => {
  beforeEach(resetProposalMocks);
describe('validateChange', () => {
    it('接受有效的 create_task', () => {
      const result = validateChange({
        type: 'create_task',
        title: '测试任务',
        project_id: 'proj-123',
        priority: 'P1',
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('拒绝不在白名单中的 action type', () => {
      const result = validateChange({ type: 'delete_database' });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('not in whitelist');
    });

    it('拒绝 null 输入', () => {
      const result = validateChange(null);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('change must be an object');
    });

    it('拒绝 undefined 输入', () => {
      const result = validateChange(undefined);
      expect(result.valid).toBe(false);
    });

    it('拒绝字符串输入', () => {
      const result = validateChange('not an object');
      expect(result.valid).toBe(false);
    });

    it('拒绝缺少 title 的 create_task', () => {
      const result = validateChange({ type: 'create_task', project_id: 'x' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('create_task requires title');
    });

    it('拒绝缺少 project_id 的 create_task', () => {
      const result = validateChange({ type: 'create_task', title: 'x' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('create_task requires project_id');
    });

    it('拒绝同时缺少 title 和 project_id 的 create_task', () => {
      const result = validateChange({ type: 'create_task' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('create_task requires title');
      expect(result.errors).toContain('create_task requires project_id');
    });

    it('拒绝 update_task 的禁止字段', () => {
      const result = validateChange({
        type: 'update_task',
        task_id: 't1',
        fields: { payload: '{"hack": true}' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('payload');
    });

    it('拒绝 update_task 的多个禁止字段', () => {
      const result = validateChange({
        type: 'update_task',
        task_id: 't1',
        fields: { payload: '{}', id: 'new-id', secret: 'x' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBe(3);
    });

    it('接受 update_task 的允许字段', () => {
      const result = validateChange({
        type: 'update_task',
        task_id: 't1',
        fields: { priority: 'P0', next_run_at: '2026-02-08', title: '新标题' },
      });
      expect(result.valid).toBe(true);
    });

    it('update_task 没有 fields 属性时不报字段错误', () => {
      const result = validateChange({ type: 'update_task', task_id: 't1' });
      expect(result.valid).toBe(true);
    });

    it('接受 set_focus（含 objective_id）', () => {
      const result = validateChange({ type: 'set_focus', objective_id: 'obj-1' });
      expect(result.valid).toBe(true);
    });

    it('拒绝缺少 objective_id 的 set_focus', () => {
      const result = validateChange({ type: 'set_focus' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('set_focus requires objective_id');
    });

    it('接受 add_dependency（含两个 ID）', () => {
      const result = validateChange({
        type: 'add_dependency',
        task_id: 't1',
        depends_on_id: 't2',
      });
      expect(result.valid).toBe(true);
    });

    it('拒绝缺少 task_id 的 add_dependency', () => {
      const result = validateChange({ type: 'add_dependency', depends_on_id: 't2' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('add_dependency requires task_id');
    });

    it('拒绝缺少 depends_on_id 的 add_dependency', () => {
      const result = validateChange({ type: 'add_dependency', task_id: 't1' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('add_dependency requires depends_on_id');
    });

    it('接受 remove_dependency（含两个 ID）', () => {
      const result = validateChange({
        type: 'remove_dependency',
        task_id: 't1',
        depends_on_id: 't2',
      });
      expect(result.valid).toBe(true);
    });

    it('拒绝缺少 task_id 的 remove_dependency', () => {
      const result = validateChange({ type: 'remove_dependency', depends_on_id: 't2' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('remove_dependency requires task_id');
    });

    it('接受 split_task 类型', () => {
      const result = validateChange({ type: 'split_task' });
      expect(result.valid).toBe(true);
    });

    it('接受 merge_tasks 类型', () => {
      const result = validateChange({ type: 'merge_tasks' });
      expect(result.valid).toBe(true);
    });
  });

describe('validateChanges', () => {
    it('验证有效的变更数组', () => {
      const result = validateChanges([
        { type: 'set_focus', objective_id: 'obj-1' },
        { type: 'update_task', task_id: 't1', fields: { priority: 'P0' } },
      ]);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('拒绝空数组', () => {
      const result = validateChanges([]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('non-empty array');
    });

    it('拒绝非数组输入', () => {
      const result = validateChanges('not an array');
      expect(result.valid).toBe(false);
    });

    it('拒绝 null 输入', () => {
      const result = validateChanges(null);
      expect(result.valid).toBe(false);
    });

    it('拒绝 undefined 输入', () => {
      const result = validateChanges(undefined);
      expect(result.valid).toBe(false);
    });

    it('收集多个变更的错误', () => {
      const result = validateChanges([
        { type: 'delete_all' },
        { type: 'create_task' }, // 缺少 title 和 project_id
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(1);
    });

    it('错误包含索引前缀', () => {
      const result = validateChanges([
        { type: 'create_task' },
      ]);
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('changes[0]');
    });

    it('超过 BULK_THRESHOLD 需要人工审核', () => {
      const changes = Array.from({ length: BULK_THRESHOLD + 1 }, (_, i) => ({
        type: 'update_task',
        task_id: `t${i}`,
        fields: { priority: 'P0' },
      }));
      const result = validateChanges(changes);
      expect(result.valid).toBe(true);
      expect(result.requires_review).toBe(true);
    });

    it('少量变更不需要审核', () => {
      const result = validateChanges([
        { type: 'set_focus', objective_id: 'obj-1' },
      ]);
      expect(result.requires_review).toBe(false);
    });

    it('恰好等于 BULK_THRESHOLD 不需要审核', () => {
      const changes = Array.from({ length: BULK_THRESHOLD }, (_, i) => ({
        type: 'update_task',
        task_id: `t${i}`,
        fields: { priority: 'P0' },
      }));
      const result = validateChanges(changes);
      expect(result.requires_review).toBe(false);
    });
  });

describe('hasCycleInGraph', () => {
    it('检测自依赖', () => {
      const adj = new Map();
      expect(hasCycleInGraph('t1', 't1', adj)).toBe(true);
    });

    it('检测简单环 A->B->A', () => {
      // B 已依赖 A
      const adj = new Map([['B', ['A']]]);
      // 添加 A 依赖 B → A->B->A（环！）
      expect(hasCycleInGraph('A', 'B', adj)).toBe(true);
    });

    it('允许有效依赖（无环）', () => {
      const adj = new Map([['B', ['C']]]);
      // 添加 A 依赖 B: A->B->C（线性，无环）
      expect(hasCycleInGraph('A', 'B', adj)).toBe(false);
    });

    it('检测传递环 A->B->C->A', () => {
      const adj = new Map([['B', ['C']], ['C', ['A']]]);
      expect(hasCycleInGraph('A', 'B', adj)).toBe(true);
    });

    it('处理空图', () => {
      const adj = new Map();
      expect(hasCycleInGraph('A', 'B', adj)).toBe(false);
    });

    it('处理复杂无环图', () => {
      // D->C, C->B, B->A（线性链）
      const adj = new Map([['D', ['C']], ['C', ['B']], ['B', ['A']]]);
      // 添加 E 依赖 D: E->D->C->B->A（无环）
      expect(hasCycleInGraph('E', 'D', adj)).toBe(false);
    });

    it('处理含多个分支的图', () => {
      // A->B, A->C, B->D, C->D
      const adj = new Map([['A', ['B', 'C']], ['B', ['D']], ['C', ['D']]]);
      // 添加 E 依赖 A（无环）
      expect(hasCycleInGraph('E', 'A', adj)).toBe(false);
    });

    it('处理长链环', () => {
      // A->B, B->C, C->D, D->E
      const adj = new Map([['A', ['B']], ['B', ['C']], ['C', ['D']], ['D', ['E']]]);
      // 添加 E 依赖 A → E->A->B->C->D->E（环！）
      expect(hasCycleInGraph('E', 'A', adj)).toBe(true);
    });
  });

describe('detectCycle', () => {
    it('自依赖立即返回 true（不查 DB）', async () => {
      const result = await detectCycle('t1', 't1');
      expect(result).toBe(true);
      // 不应查询 DB
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it('从 DB 加载图并检测无环', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'B', deps: ['C'] },
          { id: 'C', deps: ['D'] },
        ],
      });
      // A->B 不构成环
      const result = await detectCycle('A', 'B');
      expect(result).toBe(false);
      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('从 DB 加载图并检测有环', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'B', deps: ['A'] },
        ],
      });
      // A->B，而 B 已经依赖 A → 环
      const result = await detectCycle('A', 'B');
      expect(result).toBe(true);
    });

    it('DB 返回空数据时无环', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await detectCycle('A', 'B');
      expect(result).toBe(false);
    });

    it('DB 中有 null deps 的行被跳过', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'B', deps: null },
          { id: 'C', deps: [] },
        ],
      });
      const result = await detectCycle('A', 'B');
      expect(result).toBe(false);
    });

    it('使用 adjOverride 追加依赖', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [
          { id: 'B', deps: ['C'] },
        ],
      });
      // 通过 override 让 C 依赖 A
      const override = new Map([['C', ['A']]]);
      // A->B, B->C, C->A → 环
      const result = await detectCycle('A', 'B', override);
      expect(result).toBe(true);
    });

    it('adjOverride 为 null 时正常工作', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });
      const result = await detectCycle('A', 'B', null);
      expect(result).toBe(false);
    });
  });

describe('checkRateLimit', () => {
    it('首次请求允许通过', () => {
      const result = checkRateLimit('unique_source_' + Date.now());
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBeGreaterThan(0);
    });

    it('不同 source 有独立的限制', () => {
      const src1 = 'src1_' + Date.now();
      const src2 = 'src2_' + Date.now();
      const r1 = checkRateLimit(src1);
      const r2 = checkRateLimit(src2);
      expect(r1.allowed).toBe(true);
      expect(r2.allowed).toBe(true);
    });

    it('remaining 返回正确的剩余次数', () => {
      const src = 'remaining_test_' + Date.now();
      const result = checkRateLimit(src);
      expect(result.remaining).toBe(20); // RATE_LIMIT_MAX = 20
    });
  });
});
