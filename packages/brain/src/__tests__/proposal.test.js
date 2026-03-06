/**
 * Plan Proposal System 完整单元测试
 *
 * 覆盖所有导出函数：
 * - validateChange / validateChanges（纯验证）
 * - hasCycleInGraph / detectCycle（DAG 环检测）
 * - checkRateLimit（速率限制）
 * - createProposal（提案创建）
 * - approveProposal / applyProposal（提案审批与执行）
 * - rollbackProposal（提案回滚）
 * - rejectProposal（提案拒绝）
 * - getProposal / listProposals（查询）
 * - 常量导出
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js — 使用 vi.hoisted 确保 mock 工厂可引用
const mockQuery = vi.hoisted(() => vi.fn().mockResolvedValue({ rows: [] }));
vi.mock('../db.js', () => ({
  default: { query: mockQuery },
}));

import {
  validateChange,
  validateChanges,
  hasCycleInGraph,
  detectCycle,
  checkRateLimit,
  createProposal,
  approveProposal,
  applyProposal,
  rollbackProposal,
  rejectProposal,
  getProposal,
  listProposals,
  ALLOWED_CHANGE_TYPES,
  ALLOWED_TASK_FIELDS,
  BULK_THRESHOLD,
} from '../proposal.js';

describe('proposal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: [] });
  });

  // ==========================================================
  // validateChange — 单个变更验证
  // ==========================================================
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

  // ==========================================================
  // validateChanges — 批量变更验证
  // ==========================================================
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

  // ==========================================================
  // hasCycleInGraph — 纯图环检测（无 DB 依赖）
  // ==========================================================
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

  // ==========================================================
  // detectCycle — 数据库依赖的环检测
  // ==========================================================
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

  // ==========================================================
  // checkRateLimit — 速率限制
  // ==========================================================
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

  // ==========================================================
  // createProposal — 提案创建
  // ==========================================================
  describe('createProposal', () => {
    const validInput = {
      source: 'llm_proposal',
      type: 'reorder',
      title: '测试提案',
      changes: [
        { type: 'set_focus', objective_id: 'obj-1' },
      ],
    };

    it('成功创建提案', async () => {
      const mockProposal = { id: 'p1', title: '测试提案', status: 'pending_review' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      const result = await createProposal(validInput);
      expect(result).toEqual(mockProposal);
      expect(mockQuery).toHaveBeenCalledTimes(1);
      // 检查 INSERT 语句
      expect(mockQuery.mock.calls[0][0]).toContain('INSERT INTO proposals');
    });

    it('拒绝无效的 source', async () => {
      await expect(createProposal({
        ...validInput,
        source: 'invalid_source',
      })).rejects.toThrow('source must be llm_proposal or user_ui');
    });

    it('接受 user_ui 作为 source', async () => {
      const mockProposal = { id: 'p2', status: 'pending_review' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      const result = await createProposal({ ...validInput, source: 'user_ui' });
      expect(result).toEqual(mockProposal);
    });

    it('拒绝无效的 changes', async () => {
      await expect(createProposal({
        ...validInput,
        changes: [{ type: 'drop_table' }],
      })).rejects.toThrow('Invalid changes');
    });

    it('拒绝空 changes', async () => {
      await expect(createProposal({
        ...validInput,
        changes: [],
      })).rejects.toThrow('Invalid changes');
    });

    it('批量 changes 设置 medium risk_level', async () => {
      const changes = Array.from({ length: 6 }, (_, i) => ({
        type: 'update_task',
        task_id: `t${i}`,
        fields: { priority: 'P0' },
      }));
      const rateSource = 'create_bulk_' + Date.now();
      const mockProposal = { id: 'p3', risk_level: 'medium' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      await createProposal({
        source: 'llm_proposal',
        title: '批量提案',
        changes,
      });

      // 检查 risk_level 参数（第 8 个参数）
      const insertParams = mockQuery.mock.calls[0][1];
      expect(insertParams[7]).toBe('medium');
    });

    it('超过 15 个 changes 设置 high risk_level', async () => {
      const changes = Array.from({ length: 16 }, (_, i) => ({
        type: 'update_task',
        task_id: `t${i}`,
        fields: { title: `任务${i}` },
      }));
      const mockProposal = { id: 'p4', risk_level: 'high' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      await createProposal({
        source: 'llm_proposal',
        title: '大批量提案',
        changes,
      });

      const insertParams = mockQuery.mock.calls[0][1];
      expect(insertParams[7]).toBe('high');
    });

    it('包含优先级变更时检查速率限制', async () => {
      const mockProposal = { id: 'p5' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      // 带优先级变更的 input
      await createProposal({
        source: 'llm_proposal',
        title: '优先级变更',
        changes: [{ type: 'update_task', task_id: 't1', fields: { priority: 'P0' } }],
      });

      expect(mockQuery).toHaveBeenCalledTimes(1);
    });

    it('add_dependency 时检测环', async () => {
      // detectCycle 查询 DB
      mockQuery
        .mockResolvedValueOnce({ rows: [{ id: 'dep-target', deps: ['task-source'] }] }) // detectCycle 查询
        ;

      await expect(createProposal({
        source: 'llm_proposal',
        title: '添加依赖',
        changes: [{ type: 'add_dependency', task_id: 'task-source', depends_on_id: 'dep-target' }],
      })).rejects.toThrow('Dependency cycle detected');
    });

    it('add_dependency 无环时正常创建', async () => {
      const mockProposal = { id: 'p6' };
      // 第一次查询：detectCycle 查 DB（无环）
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // 第二次查询：INSERT
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      const result = await createProposal({
        source: 'llm_proposal',
        title: '添加依赖-无环',
        changes: [{ type: 'add_dependency', task_id: 'A', depends_on_id: 'B' }],
      });

      expect(result).toEqual(mockProposal);
    });

    it('使用提供的 risk_level 作为默认值', async () => {
      const mockProposal = { id: 'p7' };
      mockQuery.mockResolvedValueOnce({ rows: [mockProposal] });

      await createProposal({
        ...validInput,
        risk_level: 'low',
      });

      // 少量 changes 不会被提升，保持 low
      const insertParams = mockQuery.mock.calls[0][1];
      expect(insertParams[7]).toBe('low');
    });
  });

  // ==========================================================
  // getProposal — 查询单个提案
  // ==========================================================
  describe('getProposal', () => {
    it('找到提案时返回提案对象', async () => {
      const proposal = { id: 'p1', title: '测试', status: 'pending_review' };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] });

      const result = await getProposal('p1');
      expect(result).toEqual(proposal);
      expect(mockQuery).toHaveBeenCalledWith(
        expect.stringContaining('SELECT * FROM proposals'),
        ['p1']
      );
    });

    it('未找到时返回 null', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await getProposal('nonexistent');
      expect(result).toBeNull();
    });
  });

  // ==========================================================
  // listProposals — 提案列表查询
  // ==========================================================
  describe('listProposals', () => {
    it('无筛选条件时返回所有提案', async () => {
      const proposals = [
        { id: 'p1', title: '提案1' },
        { id: 'p2', title: '提案2' },
      ];
      mockQuery.mockResolvedValueOnce({ rows: proposals });

      const result = await listProposals();
      expect(result).toEqual(proposals);
      // 查询不含 WHERE，默认 limit 20
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).not.toContain('WHERE');
      expect(sql).toContain('LIMIT');
      expect(mockQuery.mock.calls[0][1]).toEqual([20]);
    });

    it('按状态筛选', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'p1' }] });

      await listProposals({ status: 'applied' });
      const sql = mockQuery.mock.calls[0][0];
      expect(sql).toContain('WHERE status = $1');
      expect(mockQuery.mock.calls[0][1][0]).toBe('applied');
    });

    it('自定义 limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await listProposals({ limit: 5 });
      const params = mockQuery.mock.calls[0][1];
      expect(params[params.length - 1]).toBe(5);
    });

    it('同时指定 status 和 limit', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await listProposals({ status: 'pending_review', limit: 10 });
      expect(mockQuery.mock.calls[0][1]).toEqual(['pending_review', 10]);
    });

    it('无参数调用使用默认值', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await listProposals();
      expect(mockQuery.mock.calls[0][1]).toEqual([20]);
    });
  });

  // ==========================================================
  // approveProposal — 提案审批
  // ==========================================================
  describe('approveProposal', () => {
    it('找不到提案时抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] }); // getProposal

      await expect(approveProposal('nonexistent')).rejects.toThrow('Proposal not found');
    });

    it('不能审批已 applied 状态的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'applied', changes: [] }],
      });

      await expect(approveProposal('p1')).rejects.toThrow('Cannot approve proposal in status "applied"');
    });

    it('不能审批已 rejected 状态的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'rejected', changes: [] }],
      });

      await expect(approveProposal('p1')).rejects.toThrow('Cannot approve proposal in status "rejected"');
    });

    it('成功审批 pending_review 提案并自动 apply', async () => {
      const proposal = { id: 'p1', status: 'pending_review', changes: [], source: 'llm_proposal' };
      // getProposal (approveProposal 内)
      mockQuery.mockResolvedValueOnce({ rows: [proposal] });
      // UPDATE (approve)
      mockQuery.mockResolvedValueOnce({ rows: [] });
      // getProposal (applyProposal 内)
      mockQuery.mockResolvedValueOnce({ rows: [{ ...proposal, status: 'approved', changes: [] }] });
      // UPDATE (save snapshot + mark applied)
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await approveProposal('p1', 'admin');
      expect(result.status).toBe('applied');
      expect(result.proposal_id).toBe('p1');
    });

    it('可以审批 draft 状态的提案', async () => {
      const proposal = { id: 'p1', status: 'draft', changes: [], source: 'user_ui' };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE approve
      mockQuery.mockResolvedValueOnce({ rows: [{ ...proposal, status: 'approved', changes: [] }] }); // getProposal for apply
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE applied

      const result = await approveProposal('p1');
      expect(result.status).toBe('applied');
    });
  });

  // ==========================================================
  // applyProposal — 提案执行
  // ==========================================================
  describe('applyProposal', () => {
    it('找不到提案时抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(applyProposal('nonexistent')).rejects.toThrow('Proposal not found');
    });

    it('不能执行非 approved 状态的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'pending_review', changes: [] }],
      });

      await expect(applyProposal('p1')).rejects.toThrow('Cannot apply proposal in status "pending_review"');
    });

    it('执行 create_task 变更', async () => {
      const proposal = {
        id: 'p1',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'create_task', title: '新任务', project_id: 'proj-1', priority: 'P0', description: '描述' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-task-id', title: '新任务' }] }); // INSERT task
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals (mark applied)

      const result = await applyProposal('p1');
      expect(result.status).toBe('applied');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[0].result.action).toBe('created');
    });

    it('执行 update_task 变更', async () => {
      const proposal = {
        id: 'p2',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'update_task', task_id: 't1', fields: { priority: 'P0', title: '更新' } },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1', priority: 'P1', status: 'queued' }] }); // snapshot SELECT
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE task
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p2');
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[0].result.action).toBe('updated');
    });

    it('执行 update_task 中 next_run_at 字段（写入 payload）', async () => {
      const proposal = {
        id: 'p-payload',
        status: 'approved',
        source: 'user_ui',
        changes: [
          { type: 'update_task', task_id: 't1', fields: { next_run_at: '2026-03-01' } },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1' }] }); // snapshot
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE payload
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals (applied)

      const result = await applyProposal('p-payload');
      expect(result.results[0].result.success).toBe(true);
      // 应该更新 payload（不是普通字段）
      const payloadUpdateCall = mockQuery.mock.calls[2];
      expect(payloadUpdateCall[0]).toContain('payload');
    });

    it('执行 set_focus 变更', async () => {
      const proposal = {
        id: 'p3',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'set_focus', objective_id: 'obj-1' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // 查询当前 focus
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPSERT working_memory
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p3');
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[0].result.action).toBe('focus_set');
    });

    it('执行 add_dependency 变更', async () => {
      const proposal = {
        id: 'p4',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'add_dependency', task_id: 't1', depends_on_id: 't2' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1', payload: { depends_on: [] } }] }); // snapshot
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE payload
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p4');
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[0].result.action).toBe('dependency_added');
    });

    it('add_dependency 不重复添加已存在的依赖', async () => {
      const proposal = {
        id: 'p4b',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'add_dependency', task_id: 't1', depends_on_id: 't2' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', payload: { depends_on: ['t2'] } }], // t2 已存在
      }); // snapshot
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p4b');
      expect(result.results[0].result.success).toBe(true);
      // 不应有额外的 UPDATE 调用来修改 payload
    });

    it('执行 remove_dependency 变更', async () => {
      const proposal = {
        id: 'p5',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'remove_dependency', task_id: 't1', depends_on_id: 't2' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 't1', payload: { depends_on: ['t2', 't3'] } }],
      }); // snapshot
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE payload
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p5');
      expect(result.results[0].result.success).toBe(true);
      expect(result.results[0].result.action).toBe('dependency_removed');
    });

    it('split_task 返回未实现', async () => {
      const proposal = {
        id: 'p6',
        status: 'approved',
        source: 'llm_proposal',
        changes: [{ type: 'split_task' }],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p6');
      expect(result.results[0].result.success).toBe(false);
      expect(result.results[0].result.error).toContain('not yet implemented');
    });

    it('merge_tasks 返回未实现', async () => {
      const proposal = {
        id: 'p7',
        status: 'approved',
        source: 'llm_proposal',
        changes: [{ type: 'merge_tasks' }],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p7');
      expect(result.results[0].result.success).toBe(false);
    });

    it('单个变更执行失败不影响其他变更', async () => {
      const proposal = {
        id: 'p8',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'set_focus', objective_id: 'obj-1' },
          { type: 'create_task', title: '任务', project_id: 'proj-1' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      // set_focus: 查 focus → 失败
      mockQuery.mockRejectedValueOnce(new Error('DB 连接断开'));
      // create_task: 成功
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'new-id', title: '任务' }] });
      // UPDATE proposals
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await applyProposal('p8');
      expect(result.results).toHaveLength(2);
      expect(result.results[0].result.success).toBe(false);
      expect(result.results[0].result.error).toBe('DB 连接断开');
      expect(result.results[1].result.success).toBe(true);
    });

    it('记录优先级变更的速率限制', async () => {
      const proposal = {
        id: 'p9',
        status: 'approved',
        source: 'llm_proposal',
        changes: [
          { type: 'update_task', task_id: 't1', fields: { priority: 'P0' } },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 't1', priority: 'P1' }] }); // snapshot
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE task
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p9');
      expect(result.status).toBe('applied');
    });

    it('空 changes 数组正常处理', async () => {
      const proposal = {
        id: 'p-empty',
        status: 'approved',
        source: 'llm_proposal',
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p-empty');
      expect(result.status).toBe('applied');
      expect(result.results).toHaveLength(0);
    });

    it('changes 为 undefined/null 时使用空数组', async () => {
      const proposal = {
        id: 'p-null-changes',
        status: 'approved',
        source: 'llm_proposal',
        changes: null,
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await applyProposal('p-null-changes');
      expect(result.status).toBe('applied');
      expect(result.results).toHaveLength(0);
    });
  });

  // ==========================================================
  // rollbackProposal — 提案回滚
  // ==========================================================
  describe('rollbackProposal', () => {
    it('找不到提案时抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(rollbackProposal('nonexistent')).rejects.toThrow('Proposal not found');
    });

    it('不能回滚非 applied 状态的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'pending_review' }],
      });

      await expect(rollbackProposal('p1')).rejects.toThrow('Cannot rollback proposal in status "pending_review"');
    });

    it('成功回滚带任务快照的提案', async () => {
      const proposal = {
        id: 'p1',
        status: 'applied',
        snapshot: {
          tasks: {
            't1': { priority: 'P1', status: 'queued', payload: {} },
          },
        },
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE task (restore)
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals (rolled_back)

      const result = await rollbackProposal('p1');
      expect(result.status).toBe('rolled_back');
      expect(result.results).toHaveLength(1);
      expect(result.results[0].task_id).toBe('t1');
      expect(result.results[0].restored).toBe(true);
    });

    it('回滚带 focus 快照的提案（恢复到非 null focus）', async () => {
      const proposal = {
        id: 'p2',
        status: 'applied',
        snapshot: {
          tasks: {},
          focus: { objective_id: 'old-obj' },
        },
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPSERT working_memory
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await rollbackProposal('p2');
      expect(result.status).toBe('rolled_back');
      expect(result.results).toContainEqual({ focus: 'restored' });
    });

    it('回滚带 focus 快照的提案（恢复到 null — 删除 focus）', async () => {
      const proposal = {
        id: 'p3',
        status: 'applied',
        snapshot: {
          tasks: {},
          focus: null,
        },
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE working_memory
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await rollbackProposal('p3');
      expect(result.results).toContainEqual({ focus: 'restored' });
      // 检查 DELETE 语句
      const deleteCall = mockQuery.mock.calls[1];
      expect(deleteCall[0]).toContain('DELETE FROM working_memory');
    });

    it('回滚时删除 create_task 创建的任务', async () => {
      const proposal = {
        id: 'p4',
        status: 'applied',
        snapshot: { tasks: {} },
        changes: [
          { type: 'create_task', title: '任务' },
        ],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [{ id: 'created-t1' }] }); // 查找 proposal 创建的任务
      mockQuery.mockResolvedValueOnce({ rows: [] }); // DELETE task
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await rollbackProposal('p4');
      expect(result.results).toContainEqual({ task_id: 'created-t1', deleted: true });
    });

    it('任务恢复失败时记录错误', async () => {
      const proposal = {
        id: 'p5',
        status: 'applied',
        snapshot: {
          tasks: {
            't1': { priority: 'P1', status: 'queued', payload: {} },
          },
        },
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockRejectedValueOnce(new Error('恢复失败')); // UPDATE task 失败
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await rollbackProposal('p5');
      expect(result.results[0].restored).toBe(false);
      expect(result.results[0].error).toBe('恢复失败');
    });

    it('空快照时正常回滚', async () => {
      const proposal = {
        id: 'p6',
        status: 'applied',
        snapshot: null,
        changes: [],
      };
      mockQuery.mockResolvedValueOnce({ rows: [proposal] }); // getProposal
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE proposals

      const result = await rollbackProposal('p6');
      expect(result.status).toBe('rolled_back');
      expect(result.results).toHaveLength(0);
    });
  });

  // ==========================================================
  // rejectProposal — 提案拒绝
  // ==========================================================
  describe('rejectProposal', () => {
    it('找不到提案时抛出错误', async () => {
      mockQuery.mockResolvedValueOnce({ rows: [] });

      await expect(rejectProposal('nonexistent')).rejects.toThrow('Proposal not found');
    });

    it('不能拒绝已 applied 的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'applied' }],
      });

      await expect(rejectProposal('p1')).rejects.toThrow('Cannot reject proposal in status "applied"');
    });

    it('成功拒绝 pending_review 提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p1', status: 'pending_review' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] }); // UPDATE

      const result = await rejectProposal('p1', '不符合要求');
      expect(result.status).toBe('rejected');
      expect(result.reason).toBe('不符合要求');
      expect(result.proposal_id).toBe('p1');
    });

    it('成功拒绝 draft 提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p2', status: 'draft' }],
      });
      mockQuery.mockResolvedValueOnce({ rows: [] });

      const result = await rejectProposal('p2');
      expect(result.status).toBe('rejected');
      expect(result.reason).toBe(''); // 默认空原因
    });

    it('不能拒绝已 rolled_back 的提案', async () => {
      mockQuery.mockResolvedValueOnce({
        rows: [{ id: 'p3', status: 'rolled_back' }],
      });

      await expect(rejectProposal('p3')).rejects.toThrow('Cannot reject proposal');
    });
  });

  // ==========================================================
  // 常量导出
  // ==========================================================
  describe('常量导出', () => {
    it('ALLOWED_CHANGE_TYPES 包含所有预期类型', () => {
      const expected = ['create_task', 'update_task', 'set_focus', 'add_dependency', 'remove_dependency', 'split_task', 'merge_tasks'];
      for (const t of expected) {
        expect(ALLOWED_CHANGE_TYPES.has(t)).toBe(true);
      }
      expect(ALLOWED_CHANGE_TYPES.size).toBe(7);
    });

    it('ALLOWED_CHANGE_TYPES 不包含危险类型', () => {
      expect(ALLOWED_CHANGE_TYPES.has('drop_table')).toBe(false);
      expect(ALLOWED_CHANGE_TYPES.has('delete_all')).toBe(false);
      expect(ALLOWED_CHANGE_TYPES.has('delete_database')).toBe(false);
    });

    it('ALLOWED_TASK_FIELDS 包含所有允许的字段', () => {
      const expected = ['priority', 'next_run_at', 'scheduled_for', 'title', 'description', 'goal_id', 'project_id', 'task_type', 'status'];
      for (const f of expected) {
        expect(ALLOWED_TASK_FIELDS.has(f)).toBe(true);
      }
      expect(ALLOWED_TASK_FIELDS.size).toBe(9);
    });

    it('ALLOWED_TASK_FIELDS 不包含敏感字段', () => {
      expect(ALLOWED_TASK_FIELDS.has('payload')).toBe(false);
      expect(ALLOWED_TASK_FIELDS.has('id')).toBe(false);
      expect(ALLOWED_TASK_FIELDS.has('created_at')).toBe(false);
    });

    it('BULK_THRESHOLD 等于 5', () => {
      expect(BULK_THRESHOLD).toBe(5);
    });
  });
});
