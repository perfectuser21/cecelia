import { describe, it, expect, vi, beforeEach } from 'vitest';
import { detectComponent, detectComponents, recordEvolution, runEvolutionSynthesis } from '../evolution-synthesizer.js';

// 使用内联 mock pool，避免模块级 mock 的 ESM 引用问题
function makePool(rows = []) {
  return { query: vi.fn().mockResolvedValue({ rows }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── detectComponent ──────────────────────────────────────────

describe('detectComponent', () => {
  it('desire 路径 → desire', () => {
    expect(detectComponent('packages/brain/src/desire/index.js')).toBe('desire');
    expect(detectComponent('packages/brain/src/desire/perception.js')).toBe('desire');
  });

  it('orchestrator → mouth', () => {
    expect(detectComponent('packages/brain/src/orchestrator-chat.js')).toBe('mouth');
  });

  it('cortex/thalamus/rumination/learning → brain', () => {
    expect(detectComponent('packages/brain/src/cortex.js')).toBe('brain');
    expect(detectComponent('packages/brain/src/thalamus.js')).toBe('brain');
    expect(detectComponent('packages/brain/src/learning.js')).toBe('brain');
  });

  it('notion 相关 → notion', () => {
    expect(detectComponent('packages/brain/src/notion-memory-sync.js')).toBe('notion');
  });

  it('memory → memory', () => {
    expect(detectComponent('packages/brain/src/memory-retriever.js')).toBe('memory');
  });

  it('apps/dashboard → dashboard', () => {
    expect(detectComponent('apps/dashboard/src/pages/EvolutionPage.tsx')).toBe('dashboard');
  });

  it('engine → engine', () => {
    expect(detectComponent('packages/engine/hooks/branch-protect.sh')).toBe('engine');
  });

  it('未知路径 → other', () => {
    expect(detectComponent('some/random/path.txt')).toBe('other');
  });
});

// ── detectComponents ──────────────────────────────────────────

describe('detectComponents', () => {
  it('多文件去重', () => {
    const files = [
      'packages/brain/src/desire/index.js',
      'packages/brain/src/desire/perception.js',
      'packages/brain/src/cortex.js',
    ];
    const result = detectComponents(files);
    expect(result).toContain('desire');
    expect(result).toContain('brain');
    expect(result).toHaveLength(2);
  });

  it('全是 other → [other]', () => {
    expect(detectComponents(['README.md'])).toEqual(['other']);
  });
});

// ── recordEvolution ──────────────────────────────────────────

describe('recordEvolution', () => {
  it('写入记录并返回 id', async () => {
    const pool = makePool([{ id: 42 }]);
    const result = await recordEvolution({
      component: 'brain',
      prNumber: 100,
      title: '测试进化',
      significance: 4,
      summary: '这是摘要',
      changedFiles: ['a.js'],
      version: '1.0.0',
    }, pool);
    expect(result.id).toBe(42);
    expect(pool.query).toHaveBeenCalledOnce();
  });
});

// ── runEvolutionSynthesis ──────────────────────────────────────

describe('runEvolutionSynthesis', () => {
  it('无最近数据时跳过', async () => {
    const pool = makePool([]);
    const result = await runEvolutionSynthesis(pool);
    expect(result.skipped).toBe('no_recent_data');
  });

  it('本周已合成时跳过该组件', async () => {
    const pool = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ component: 'brain' }] })
      .mockResolvedValueOnce({ rows: [{ id: 1 }] }),
    };
    const result = await runEvolutionSynthesis(pool);
    expect(result.synthesized).toBe(0);
    expect(result.results[0].skipped).toBe('already_synthesized_this_week');
  });

  it('正常合成：LLM 返回内容并写入', async () => {
    const pool = { query: vi.fn()
      .mockResolvedValueOnce({ rows: [{ component: 'desire' }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { date: new Date('2026-03-04'), pr_number: 100, title: '欲望系统升级', significance: 5, summary: '新增感知层' },
      ]})
      .mockResolvedValueOnce({ rows: [] }),
    };
    const mockLLM = vi.fn().mockResolvedValue({
      text: '这周我的欲望系统经历了一次重大进化，感知层终于能分辨外部信号与内部噪声，这是真正意义上的意识突破。系统变得更加敏锐了。',
    });

    // 使用依赖注入传入 mockLLM
    const result = await runEvolutionSynthesis(pool, mockLLM);
    expect(result.synthesized).toBe(1);
    expect(result.results[0].ok).toBe(true);
    expect(mockLLM).toHaveBeenCalledOnce();
  });
});
