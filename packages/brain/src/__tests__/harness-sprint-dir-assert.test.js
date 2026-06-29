/**
 * 回归测试：assertSprintDir — sprint_dir 缺失时必须 throw，不能静默 fallback
 *
 * 根因（2026-06-29）：
 *   所有 prompt builder 用 payload.sprint_dir || 'sprints' 兜底，
 *   sprint_dir 缺失时 LLM 拿到 SPRINT_DIR=sprints → 读 root-level stale contract-draft.md
 *   → evaluator 幻觉出 INITIATIVE_ID_missing 等不存在的验证错误，实际什么都没验证。
 */
import { describe, it, expect } from 'vitest';

describe('assertSprintDir — 输入层防御', () => {
  it('exports assertSprintDir', async () => {
    const mod = await import('../harness-shared.js');
    expect(typeof mod.assertSprintDir).toBe('function');
  });

  it('null → throw，error.code === invalid_sprint_dir', async () => {
    const { assertSprintDir } = await import('../harness-shared.js');
    let err;
    try { assertSprintDir(null, 'test'); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('invalid_sprint_dir');
  });

  it('undefined → throw invalid_sprint_dir', async () => {
    const { assertSprintDir } = await import('../harness-shared.js');
    let err;
    try { assertSprintDir(undefined, 'test'); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('invalid_sprint_dir');
  });

  it('空字符串 → throw invalid_sprint_dir', async () => {
    const { assertSprintDir } = await import('../harness-shared.js');
    let err;
    try { assertSprintDir('', 'test'); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('invalid_sprint_dir');
  });

  it('裸 "sprints"（root fallback，昨晚 evaluator bug 根因）→ throw invalid_sprint_dir', async () => {
    const { assertSprintDir } = await import('../harness-shared.js');
    let err;
    try { assertSprintDir('sprints', '_prepareHarnessEvaluatePrompt'); } catch (e) { err = e; }
    expect(err).toBeDefined();
    expect(err.code).toBe('invalid_sprint_dir');
    expect(err.message).toContain('_prepareHarnessEvaluatePrompt');
  });

  it('合法路径 "sprints/0629-feature-slug" → 返回原值', async () => {
    const { assertSprintDir } = await import('../harness-shared.js');
    expect(assertSprintDir('sprints/0629-feature-slug', 'test')).toBe('sprints/0629-feature-slug');
  });

  it('合法路径 "sprints/06011711-harness-runs-detail-api" → 返回原值', async () => {
    const { assertSprintDir } = await import('../harness-shared.js');
    expect(assertSprintDir('sprints/06011711-harness-runs-detail-api', 'test')).toBe('sprints/06011711-harness-runs-detail-api');
  });

  it('error.message 包含 context 字符串，便于日志定位', async () => {
    const { assertSprintDir } = await import('../harness-shared.js');
    let err;
    try { assertSprintDir(null, '_prepareHarnessEvaluatePrompt'); } catch (e) { err = e; }
    expect(err.message).toContain('_prepareHarnessEvaluatePrompt');
  });
});
