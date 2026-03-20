import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock db.js before importing the module
vi.mock('../db.js', () => ({
  default: {
    query: vi.fn(),
  },
}));

const { getDecisionsSummary, _buildSummary } = await import('../decisions-context.js');
const pool = (await import('../db.js')).default;

describe('decisions-context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('_buildSummary', () => {
    it('空数组返回空字符串', () => {
      expect(_buildSummary([])).toBe('');
    });

    it('null 返回空字符串', () => {
      expect(_buildSummary(null)).toBe('');
    });

    it('按 category 分组 user 决策', () => {
      const rows = [
        { owner: 'user', category: 'architecture', topic: 'Vision', decision: '帮助盈利' },
        { owner: 'user', category: 'architecture', topic: '执行器', decision: '只用 Claude + Codex' },
        { owner: 'user', category: 'priority', topic: '优先级', decision: 'Cecelia 先稳定' },
      ];
      const result = _buildSummary(rows);

      expect(result).toContain('用户决策');
      expect(result).toContain('architecture');
      expect(result).toContain('priority');
      expect(result).toContain('Vision');
      expect(result).toContain('执行器');
    });

    it('user 和 cecelia 决策分开标注', () => {
      const rows = [
        { owner: 'user', category: 'priority', topic: '测试', decision: '用户说的' },
        { owner: 'cecelia', category: 'architecture', topic: '系统决定', decision: '系统判断的' },
      ];
      const result = _buildSummary(rows);

      expect(result).toContain('用户决策（最高权限）');
      expect(result).toContain('系统决策（用户可推翻）');
    });

    it('只有 user 决策时不显示系统决策段落', () => {
      const rows = [
        { owner: 'user', category: 'priority', topic: '测试', decision: '用户说的' },
      ];
      const result = _buildSummary(rows);

      expect(result).toContain('用户决策');
      expect(result).not.toContain('系统决策');
    });

    it('超长摘要被截断', () => {
      const rows = Array.from({ length: 50 }, (_, i) => ({
        owner: 'user',
        category: `cat-${i}`,
        topic: `topic-${i}`,
        decision: `这是一个很长的决策描述用于测试截断逻辑 ${i}`,
      }));
      const result = _buildSummary(rows);

      expect(result.length).toBeLessThanOrEqual(520); // 500 + truncation message
      expect(result).toContain('截断');
    });
  });

  describe('getDecisionsSummary', () => {
    it('查询 decisions 表并返回摘要', async () => {
      pool.query.mockResolvedValue({
        rows: [
          { owner: 'user', category: 'architecture', topic: 'test', decision: 'test decision' },
        ],
      });

      const result = await getDecisionsSummary();

      expect(pool.query).toHaveBeenCalledWith(
        expect.stringContaining('decisions'),
      );
      expect(result).toContain('test decision');
    });

    it('DB 查询失败时返回空字符串', async () => {
      pool.query.mockRejectedValue(new Error('connection refused'));

      const result = await getDecisionsSummary();

      expect(result).toBe('');
    });

    it('无活跃决策时返回空字符串', async () => {
      pool.query.mockResolvedValue({ rows: [] });

      const result = await getDecisionsSummary();

      expect(result).toBe('');
    });
  });
});
