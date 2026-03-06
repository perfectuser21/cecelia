/**
 * evolution-scanner.test.js
 *
 * 覆盖 evolution-scanner.js 的所有导出函数：
 *   - scanEvolutionIfNeeded(pool)
 *   - synthesizeEvolutionIfNeeded(pool)
 *
 * 内部辅助函数通过行为验证间接覆盖：
 *   - detectComponent(filePaths)
 *   - sigScore(title, codeFileCount)
 *   - ghFetch(path)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── vi.hoisted：factory 内引用的所有顶层变量必须先 hoist ──

const mockRunEvolutionSynthesis = vi.hoisted(() => vi.fn());

// ── vi.mock：在 import 之前执行 ────────────────────────────

vi.mock('../evolution-synthesizer.js', () => ({
  runEvolutionSynthesis: mockRunEvolutionSynthesis,
}));

// mock 全局 fetch（evolution-scanner.js 使用 global fetch）
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

// ── 导入被测模块 ──────────────────────────────────────────

import { scanEvolutionIfNeeded, synthesizeEvolutionIfNeeded } from '../evolution-scanner.js';

// ── 测试工具函数 ──────────────────────────────────────────

/** 创建一个可配置的 mock pool */
function makePool(queryImpl) {
  return { query: queryImpl ?? vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }) };
}

/** 构造一个合并的 PR 对象 */
function makePR(overrides = {}) {
  const now = new Date().toISOString();
  return {
    number: 100,
    title: 'feat: 添加新功能',
    merged_at: now,
    ...overrides,
  };
}

// ── beforeEach / afterEach ────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GITHUB_TOKEN;
});

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
});

// ══════════════════════════════════════════════════════════
// scanEvolutionIfNeeded
// ══════════════════════════════════════════════════════════

describe('scanEvolutionIfNeeded', () => {

  // ── 门控：今日已扫 ──────────────────────────────────────

  describe('每日门控', () => {
    it('今日已扫描时直接返回 skipped', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const pool = makePool(vi.fn().mockResolvedValue({
        rows: [{ value_json: { date: today } }],
        rowCount: 1,
      }));

      const result = await scanEvolutionIfNeeded(pool);

      expect(result).toEqual({ ok: true, skipped: 'already_scanned_today' });
      // 跳过后不调用 fetch
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('没有扫描记录时继续执行', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 读门控
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 更新门控
      };

      // GitHub API 返回空列表（无合并 PR）
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await scanEvolutionIfNeeded(pool);

      expect(result.ok).toBe(true);
      expect(result.checked).toBe(0);
    });

    it('上次扫描日期不是今天时继续执行', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value_json: { date: '2020-01-01' } }], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // 更新门控
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.ok).toBe(true);
    });

    it('读取 working_memory 抛出异常时继续执行（不崩溃）', async () => {
      const pool = {
        query: vi.fn()
          .mockRejectedValueOnce(new Error('DB connection lost'))
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // 更新门控
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.ok).toBe(true);
    });
  });

  // ── GitHub API 调用 ──────────────────────────────────────

  describe('GitHub API 交互', () => {
    it('不设置 GITHUB_TOKEN 时请求头中不含 Authorization', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await scanEvolutionIfNeeded(pool);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBeUndefined();
    });

    it('设置 GITHUB_TOKEN 时请求头中包含 Authorization Bearer', async () => {
      process.env.GITHUB_TOKEN = 'ghp_test_token';

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await scanEvolutionIfNeeded(pool);

      const [, options] = mockFetch.mock.calls[0];
      expect(options.headers['Authorization']).toBe('Bearer ghp_test_token');
    });

    it('GitHub API 返回非 200 时抛出错误', async () => {
      const pool = {
        query: vi.fn().mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
      });

      await expect(scanEvolutionIfNeeded(pool)).rejects.toThrow('GitHub API 403 Forbidden');
    });

    it('请求 URL 包含正确的 owner/repo', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await scanEvolutionIfNeeded(pool);

      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('/repos/perfectuser21/cecelia/pulls');
    });
  });

  // ── PR 过滤：只处理最近 2 天合并的 PR ──────────────────

  describe('PR 过滤', () => {
    it('只处理 2 天内合并的 PR，过期 PR 被过滤', async () => {
      const recentMergedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(); // 1天前
      const oldMergedAt = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();   // 5天前

      const prs = [
        makePR({ number: 1, title: 'feat: 新功能', merged_at: recentMergedAt }),
        makePR({ number: 2, title: 'fix: 修复旧问题', merged_at: oldMergedAt }),
      ];

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })          // 读门控
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })          // 去重查询 PR#1
          .mockResolvedValueOnce({ rows: [{ id: 1 }], rowCount: 1 }) // INSERT PR#1
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })          // 更新门控
      };

      // PR 列表
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      // PR#1 文件列表
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ filename: 'packages/brain/src/tick.js' }]),
      });

      const result = await scanEvolutionIfNeeded(pool);
      // 只有 1 个最近的 PR 被处理
      expect(result.checked).toBe(1);
      expect(result.inserted).toBe(1);
    });

    it('未合并的 PR（merged_at 为 null）被过滤', async () => {
      const prs = [
        makePR({ number: 3, merged_at: null }),
      ];

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.checked).toBe(0);
      expect(result.inserted).toBe(0);
    });
  });

  // ── 去重逻辑 ────────────────────────────────────────────

  describe('PR 去重', () => {
    it('已存在的 PR 跳过不重复插入', async () => {
      const mergedAt = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 50, merged_at: mergedAt })];

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })           // 读门控
          .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // 去重：已存在
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })           // 更新门控
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.skipped).toBe(1);
      expect(result.inserted).toBe(0);
    });

    it('同一批次两个 PR，一个已存在一个新的', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [
        makePR({ number: 10, title: 'feat: 新功能 A', merged_at: mergedAt }),
        makePR({ number: 11, title: 'feat: 新功能 B', merged_at: mergedAt }),
      ];

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })            // 读门控
          .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // PR#10 已存在
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })            // PR#11 不存在
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })            // PR#11 INSERT
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })            // 更新门控
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      // PR#11 文件列表
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ filename: 'packages/brain/src/cortex.js' }]),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.skipped).toBeGreaterThanOrEqual(1);
      expect(result.inserted).toBeGreaterThanOrEqual(1);
    });
  });

  // ── 组件检测（detectComponent 间接测试）──────────────────

  describe('组件检测行为', () => {
    it('全是非代码文件（SKIP 匹配）时 comp=null，PR 被跳过', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 20, title: 'docs: 更新说明', merged_at: mergedAt })];

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })    // 读门控
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })    // 去重：不存在
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })    // 更新门控
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      // 只有 .md 文件（全部被 SKIP 过滤）
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { filename: 'DEFINITION.md' },
          { filename: 'README.md' },
          { filename: 'package.json' },
        ]),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.skipped).toBe(1);
      expect(result.inserted).toBe(0);
    });

    it('desire 路径文件优先被识别为 desire 组件', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 21, title: 'feat: 欲望系统升级', merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 读门控
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 去重
          .mockImplementationOnce((sql, params) => {           // INSERT
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 更新门控
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { filename: 'packages/brain/src/desire/index.js' },
          { filename: 'packages/brain/src/cortex.js' },
        ]),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.inserted).toBe(1);
      // component 字段（第2个参数，index 1）应为 'desire'
      expect(insertArgs[0][1]).toBe('desire');
    });

    it('engine 路径文件被识别为 engine 组件', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 22, title: 'feat(engine): 加强 hook', merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockImplementationOnce((sql, params) => {
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { filename: 'packages/engine/hooks/stop.sh' },
        ]),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.inserted).toBe(1);
      expect(insertArgs[0][1]).toBe('engine');
    });

    it('dashboard 路径被正确识别', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 23, title: 'feat(dashboard): 新页面', merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockImplementationOnce((sql, params) => {
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { filename: 'apps/dashboard/src/pages/Home.tsx' },
        ]),
      });

      await scanEvolutionIfNeeded(pool);
      expect(insertArgs[0][1]).toBe('dashboard');
    });

    it('memory 路径（memory-retriever）被识别为 memory', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 24, title: 'feat: 记忆检索优化', merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockImplementationOnce((sql, params) => {
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { filename: 'packages/brain/src/memory-retriever.js' },
        ]),
      });

      await scanEvolutionIfNeeded(pool);
      expect(insertArgs[0][1]).toBe('memory');
    });

    it('mouth 路径（orchestrator-chat）被识别为 mouth', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 25, title: 'feat: 嘴巴升级', merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockImplementationOnce((sql, params) => {
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { filename: 'packages/brain/src/orchestrator-chat.js' },
        ]),
      });

      await scanEvolutionIfNeeded(pool);
      expect(insertArgs[0][1]).toBe('mouth');
    });

    it('brain 通用路径文件被识别为 brain 组件', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 26, title: 'feat: cortex 升级', merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockImplementationOnce((sql, params) => {
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { filename: 'packages/brain/src/cortex.js' },
        ]),
      });

      await scanEvolutionIfNeeded(pool);
      expect(insertArgs[0][1]).toBe('brain');
    });

    it('优先级排序：desire + brain 混合时选择 desire', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 27, title: 'feat: 混合文件', merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockImplementationOnce((sql, params) => {
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([
          { filename: 'packages/brain/src/thalamus.js' },      // brain
          { filename: 'packages/brain/src/desire/index.js' },  // desire（优先）
          { filename: 'packages/brain/migrations/001.sql' },    // brain
        ]),
      });

      await scanEvolutionIfNeeded(pool);
      // desire 优先级高于 brain
      expect(insertArgs[0][1]).toBe('desire');
    });
  });

  // ── significance score（sigScore 间接测试）──────────────

  describe('significance score 计算', () => {
    /** 执行扫描并返回 INSERT 时的 significance 参数 */
    async function runWithTitle(title, files = ['packages/brain/src/tick.js']) {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 30, title, merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockImplementationOnce((sql, params) => {
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(files.map(f => ({ filename: f }))),
      });

      await scanEvolutionIfNeeded(pool);
      return insertArgs[0]?.[4]; // significance 是第 5 个参数（index 4）
    }

    it('feat! 标题 → significance 5', async () => {
      const sig = await runWithTitle('feat!: 破坏性变更');
      expect(sig).toBe(5);
    });

    it('breaking 关键词 → significance 5', async () => {
      const sig = await runWithTitle('refactor: breaking change in API');
      expect(sig).toBe(5);
    });

    it('feat + 文件数 > 15 → significance 4', async () => {
      const manyFiles = Array.from({ length: 16 }, (_, i) => `packages/brain/src/file${i}.js`);
      const sig = await runWithTitle('feat: 大型功能', manyFiles);
      expect(sig).toBe(4);
    });

    it('feat + 普通文件数（<=15）→ significance 3', async () => {
      const sig = await runWithTitle('feat: 普通功能');
      expect(sig).toBe(3);
    });

    it('fix + 文件数 > 8 → significance 3', async () => {
      const manyFiles = Array.from({ length: 9 }, (_, i) => `packages/brain/src/fix${i}.js`);
      const sig = await runWithTitle('fix: 大型修复', manyFiles);
      expect(sig).toBe(3);
    });

    it('fix + 普通文件数（<=8）→ significance 2', async () => {
      const sig = await runWithTitle('fix: 小修复');
      expect(sig).toBe(2);
    });

    it('chore 标题 → significance 1（默认）', async () => {
      const sig = await runWithTitle('chore: 清理代码');
      expect(sig).toBe(1);
    });

    it('test 标题 → significance 1（默认）', async () => {
      const sig = await runWithTitle('test: 新增测试');
      expect(sig).toBe(1);
    });
  });

  // ── 版本号提取 ────────────────────────────────────────

  describe('版本号提取', () => {
    it('标题含版本号时正确提取（vX.Y.Z 格式）', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 40, title: 'feat: 升级功能 (v1.197.2)', merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockImplementationOnce((sql, params) => {
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ filename: 'packages/brain/src/server.js' }]),
      });

      await scanEvolutionIfNeeded(pool);
      // version 是第 7 个参数（index 6）
      expect(insertArgs[0][6]).toBe('1.197.2');
    });

    it('标题不含版本号时 version 为 null', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 41, title: 'feat: 无版本号功能', merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockImplementationOnce((sql, params) => {
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ filename: 'packages/brain/src/server.js' }]),
      });

      await scanEvolutionIfNeeded(pool);
      expect(insertArgs[0][6]).toBeNull();
    });

    it('merged_at 日期正确提取为 date 字段', async () => {
      const mergedAt = '2026-03-05T14:30:00Z';
      const prs = [makePR({ number: 42, merged_at: mergedAt })];

      const insertArgs = [];
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockImplementationOnce((sql, params) => {
            insertArgs.push(params);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      // 要让 pr 在 since 范围内（2天内）
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([{ filename: 'packages/brain/src/tick.js' }]),
      });

      await scanEvolutionIfNeeded(pool);
      // date 是第 1 个参数（index 0）
      expect(insertArgs[0]?.[0]).toBe('2026-03-05');
    });
  });

  // ── 文件获取失败容错 ──────────────────────────────────

  describe('文件获取失败容错', () => {
    it('PR 文件列表 API 失败时 filePaths 为空，detectComponent 返回 null，PR 被跳过', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 50, merged_at: mergedAt })];

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 读门控
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 去重
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 更新门控
      };

      // PR 列表成功
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      // 文件列表 API 失败（HTTP error）
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const result = await scanEvolutionIfNeeded(pool);
      // detectComponent([]) 返回 null → 计入 skipped
      expect(result.skipped).toBe(1);
      expect(result.inserted).toBe(0);
    });

    it('PR 文件列表 fetch 抛出异常时不崩溃', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [makePR({ number: 51, merged_at: mergedAt })];

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 读门控
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 去重
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 更新门控
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });
      // fetch 网络异常
      mockFetch.mockRejectedValueOnce(new Error('network timeout'));

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.ok).toBe(true);
      expect(result.skipped).toBe(1);
    });
  });

  // ── 更新门控 ──────────────────────────────────────────

  describe('更新 working_memory 门控', () => {
    it('扫描完成后写入今日日期到 working_memory', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const updatedKeys = [];

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 读门控
          .mockImplementationOnce((sql, params) => {            // 更新门控
            updatedKeys.push(params?.[0]);
            return Promise.resolve({ rows: [], rowCount: 1 });
          })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      await scanEvolutionIfNeeded(pool);

      expect(updatedKeys).toContain('evolution_last_scan_date');
      const callArgs = pool.query.mock.calls.find(c => c[1]?.[0] === 'evolution_last_scan_date');
      const storedValue = JSON.parse(callArgs[1][1]);
      expect(storedValue.date).toBe(today);
    });

    it('更新 working_memory 失败时不影响返回结果', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })   // 读门控
          .mockRejectedValueOnce(new Error('Write failed'))   // 更新门控失败
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.ok).toBe(true);
    });

    it('返回值中 checked 等于 mergedPRs 数量', async () => {
      const mergedAt = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      const prs = [
        makePR({ number: 60, title: 'feat: A', merged_at: mergedAt }),
        makePR({ number: 61, title: 'feat: B', merged_at: mergedAt }),
      ];

      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })            // 读门控
          .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // PR#60 已存在
          .mockResolvedValueOnce({ rows: [{ '?column?': 1 }], rowCount: 1 }) // PR#61 已存在
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })            // 更新门控
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve(prs),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.checked).toBe(2);
      expect(result.skipped).toBe(2);
      expect(result.inserted).toBe(0);
    });
  });

  // ── 返回值结构 ────────────────────────────────────────

  describe('返回值结构', () => {
    it('正常执行时返回 { ok, checked, inserted, skipped }', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve([]),
      });

      const result = await scanEvolutionIfNeeded(pool);
      expect(result).toMatchObject({
        ok: true,
        checked: expect.any(Number),
        inserted: expect.any(Number),
        skipped: expect.any(Number),
      });
    });

    it('skipped=already_scanned_today 时返回字符串而非数字', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const pool = makePool(vi.fn().mockResolvedValue({
        rows: [{ value_json: { date: today } }],
        rowCount: 1,
      }));

      const result = await scanEvolutionIfNeeded(pool);
      expect(result.skipped).toBe('already_scanned_today');
      expect(typeof result.skipped).toBe('string');
    });
  });
});

// ══════════════════════════════════════════════════════════
// synthesizeEvolutionIfNeeded
// ══════════════════════════════════════════════════════════

describe('synthesizeEvolutionIfNeeded', () => {

  // ── 每周门控 ──────────────────────────────────────────

  describe('每周门控', () => {
    it('7 天内已合成时返回 skipped', async () => {
      const recentDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const pool = makePool(vi.fn().mockResolvedValue({
        rows: [{ value_json: { date: recentDate } }],
        rowCount: 1,
      }));

      const result = await synthesizeEvolutionIfNeeded(pool);

      expect(result.ok).toBe(true);
      expect(result.skipped).toBe('synthesized_within_7_days');
      expect(result.days_since).toBeLessThan(7);
      expect(mockRunEvolutionSynthesis).not.toHaveBeenCalled();
    });

    it('恰好 7 天时（daysSince=7）执行合成（不满足 < 7 条件）', async () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value_json: { date: sevenDaysAgo } }], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // 更新门控
      };

      mockRunEvolutionSynthesis.mockResolvedValueOnce({ synthesized: 0, results: [] });

      const result = await synthesizeEvolutionIfNeeded(pool);
      expect(mockRunEvolutionSynthesis).toHaveBeenCalledOnce();
      expect(result).toBeDefined();
    });

    it('超过 7 天时执行合成', async () => {
      const oldDate = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [{ value_json: { date: oldDate } }], rowCount: 1 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockRunEvolutionSynthesis.mockResolvedValueOnce({ synthesized: 2, results: [] });

      await synthesizeEvolutionIfNeeded(pool);
      expect(mockRunEvolutionSynthesis).toHaveBeenCalledOnce();
    });

    it('没有合成记录时执行合成', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // 无记录
          .mockResolvedValueOnce({ rows: [], rowCount: 0 }) // 更新门控
      };

      mockRunEvolutionSynthesis.mockResolvedValueOnce({ synthesized: 1, results: [] });

      await synthesizeEvolutionIfNeeded(pool);
      expect(mockRunEvolutionSynthesis).toHaveBeenCalledOnce();
    });

    it('读取合成门控失败时继续执行合成（容错）', async () => {
      const pool = {
        query: vi.fn()
          .mockRejectedValueOnce(new Error('DB error'))
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockRunEvolutionSynthesis.mockResolvedValueOnce({ synthesized: 0, results: [] });

      await synthesizeEvolutionIfNeeded(pool);
      expect(mockRunEvolutionSynthesis).toHaveBeenCalledOnce();
    });
  });

  // ── 合成后写入门控 ──────────────────────────────────────

  describe('合成后写入门控', () => {
    it('synthesized > 0 时写入 evolution_last_synthesis_date', async () => {
      const today = new Date().toISOString().slice(0, 10);
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // 无历史记录
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })  // 写入门控
      };

      mockRunEvolutionSynthesis.mockResolvedValueOnce({ synthesized: 3, results: [] });

      await synthesizeEvolutionIfNeeded(pool);

      // 第二次 query 应该是更新门控
      expect(pool.query).toHaveBeenCalledTimes(2);
      const lastCall = pool.query.mock.calls[1];
      expect(lastCall[1][0]).toBe('evolution_last_synthesis_date');
      const stored = JSON.parse(lastCall[1][1]);
      expect(stored.date).toBe(today);
      expect(stored.synthesized).toBe(3);
    });

    it('synthesized = 0 时不写入门控', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockRunEvolutionSynthesis.mockResolvedValueOnce({ synthesized: 0, results: [] });

      await synthesizeEvolutionIfNeeded(pool);

      // 只有一次 query（读门控），不写入
      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('synthesized 字段缺失（undefined）时 ?? 0 变成 0，不写入门控', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      // synthesized 字段缺失
      mockRunEvolutionSynthesis.mockResolvedValueOnce({ results: [] });

      await synthesizeEvolutionIfNeeded(pool);

      expect(pool.query).toHaveBeenCalledTimes(1);
    });

    it('写入合成门控失败时不影响返回值', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockRejectedValueOnce(new Error('Write failed'))
      };

      mockRunEvolutionSynthesis.mockResolvedValueOnce({ synthesized: 1, results: [] });

      const result = await synthesizeEvolutionIfNeeded(pool);
      // 正常返回合成结果，不崩溃
      expect(result.synthesized).toBe(1);
    });

    it('synthesized > 0 时门控内容包含 synthesized 数量', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockRunEvolutionSynthesis.mockResolvedValueOnce({ synthesized: 5, results: [] });

      await synthesizeEvolutionIfNeeded(pool);

      const updateCall = pool.query.mock.calls[1];
      const stored = JSON.parse(updateCall[1][1]);
      expect(stored.synthesized).toBe(5);
    });
  });

  // ── 返回值透传 ────────────────────────────────────────

  describe('返回值透传', () => {
    it('返回 runEvolutionSynthesis 的完整结果', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      const synthesisResult = {
        synthesized: 2,
        results: [
          { component: 'brain', ok: true },
          { component: 'memory', ok: true },
        ],
      };
      mockRunEvolutionSynthesis.mockResolvedValueOnce(synthesisResult);

      const result = await synthesizeEvolutionIfNeeded(pool);
      expect(result).toEqual(synthesisResult);
    });

    it('skipped 场景返回 { ok, skipped, days_since }', async () => {
      const recentDate = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const pool = makePool(vi.fn().mockResolvedValue({
        rows: [{ value_json: { date: recentDate } }],
        rowCount: 1,
      }));

      const result = await synthesizeEvolutionIfNeeded(pool);
      expect(result).toMatchObject({
        ok: true,
        skipped: 'synthesized_within_7_days',
        days_since: expect.any(Number),
      });
    });

    it('runEvolutionSynthesis 传入的是 pool 对象本身', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockRunEvolutionSynthesis.mockResolvedValueOnce({ synthesized: 0, results: [] });

      await synthesizeEvolutionIfNeeded(pool);
      expect(mockRunEvolutionSynthesis).toHaveBeenCalledWith(pool);
    });

    it('runEvolutionSynthesis 只被调用一次', async () => {
      const pool = {
        query: vi.fn()
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
          .mockResolvedValueOnce({ rows: [], rowCount: 0 })
      };

      mockRunEvolutionSynthesis.mockResolvedValueOnce({ synthesized: 1, results: [] });

      await synthesizeEvolutionIfNeeded(pool);
      expect(mockRunEvolutionSynthesis).toHaveBeenCalledTimes(1);
    });
  });

  // ── days_since 计算边界 ───────────────────────────────

  describe('days_since 计算', () => {
    it('6 天前合成 → days_since=6，仍返回 skipped', async () => {
      const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const pool = makePool(vi.fn().mockResolvedValue({
        rows: [{ value_json: { date: sixDaysAgo } }],
        rowCount: 1,
      }));

      const result = await synthesizeEvolutionIfNeeded(pool);
      expect(result.skipped).toBe('synthesized_within_7_days');
      expect(result.days_since).toBe(6);
    });

    it('1 天前合成 → days_since=1，返回 skipped', async () => {
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const pool = makePool(vi.fn().mockResolvedValue({
        rows: [{ value_json: { date: oneDayAgo } }],
        rowCount: 1,
      }));

      const result = await synthesizeEvolutionIfNeeded(pool);
      expect(result.days_since).toBe(1);
      expect(mockRunEvolutionSynthesis).not.toHaveBeenCalled();
    });

    it('今天合成 → days_since=0，返回 skipped', async () => {
      const todayDate = new Date().toISOString().slice(0, 10);
      const pool = makePool(vi.fn().mockResolvedValue({
        rows: [{ value_json: { date: todayDate } }],
        rowCount: 1,
      }));

      const result = await synthesizeEvolutionIfNeeded(pool);
      expect(result.days_since).toBe(0);
      expect(result.skipped).toBe('synthesized_within_7_days');
    });
  });
});
