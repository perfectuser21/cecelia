/**
 * Test: preparePrompt 失败上下文注入
 *
 * DoD 映射：
 * - DoD-1: 首次执行（failure_count=0 或无）不注入任何内容
 * - DoD-2: retry + classification 时注入 class + reason
 * - DoD-3: retry + feedback 时注入 summary + issues_found
 * - DoD-4: retry + classification + feedback 时两段都注入
 * - DoD-5: 注入内容 >2000 字符时截断
 * - DoD-6: 4 条 preparePrompt return 路径都注入
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../db.js', () => ({
  default: { query: vi.fn() }
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(),
  execSync: vi.fn(() => '')
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn()
}));

vi.mock('fs', () => ({
  readFileSync: vi.fn(() => 'SwapTotal: 0\nSwapFree: 0')
}));

vi.mock('../task-router.js', () => ({
  getTaskLocation: vi.fn(() => 'us')
}));

vi.mock('../task-updater.js', () => ({
  updateTaskStatus: vi.fn(),
  updateTaskProgress: vi.fn()
}));

vi.mock('../trace.js', () => ({
  traceStep: vi.fn(),
  LAYER: { EXECUTOR: 'executor', L0_ORCHESTRATOR: 'l0' },
  STATUS: { START: 'start', SUCCESS: 'success', FAILED: 'failed' },
  EXECUTOR_HOSTS: { US: 'us', HK: 'hk', US_VPS: 'us_vps' }
}));

describe('buildRetryContext: 失败上下文构建', () => {
  let buildRetryContext;

  beforeEach(async () => {
    vi.resetModules();
    const executor = await import('../executor.js');
    buildRetryContext = executor.buildRetryContext;
  });

  // DoD-1: 首次执行不注入
  it('DoD-1: failure_count=0 → 返回空字符串', () => {
    const result = buildRetryContext({ payload: { failure_count: 0 } });
    expect(result).toBe('');
  });

  it('DoD-1: payload 为空 → 返回空字符串', () => {
    const result = buildRetryContext({ payload: {} });
    expect(result).toBe('');
  });

  it('DoD-1: payload 为 null → 返回空字符串', () => {
    const result = buildRetryContext({ payload: null });
    expect(result).toBe('');
  });

  // DoD-2: retry + classification
  it('DoD-2: failure_count>0 + classification.class → 注入 class', () => {
    const result = buildRetryContext({
      payload: {
        failure_count: 1,
        failure_classification: {
          class: 'code_error',
          retry_strategy: { reason: 'CI test failed' }
        }
      }
    });
    expect(result).toContain('code_error');
    expect(result).toContain('CI test failed');
    expect(result).toContain('第 1 次尝试');
  });

  it('DoD-2: watchdog_kill.reason 时也注入', () => {
    const result = buildRetryContext({
      payload: {
        failure_count: 2,
        watchdog_kill: { reason: 'OOM killed' }
      }
    });
    expect(result).toContain('OOM killed');
    expect(result).toContain('第 2 次尝试');
  });

  // DoD-3: retry + feedback
  it('DoD-3: feedback.summary 时注入 summary', () => {
    const result = buildRetryContext({
      payload: { failure_count: 1 },
      feedback: [
        { summary: '编译失败，缺少依赖', issues_found: ['缺少 lodash 包'] }
      ]
    });
    expect(result).toContain('编译失败，缺少依赖');
    expect(result).toContain('缺少 lodash 包');
  });

  it('DoD-3: issues_found 为字符串时也注入', () => {
    const result = buildRetryContext({
      payload: { failure_count: 1 },
      feedback: [{ summary: '失败', issues_found: '测试断言错误' }]
    });
    expect(result).toContain('测试断言错误');
  });

  it('DoD-3: 取最近一条 feedback（最后一项）', () => {
    const result = buildRetryContext({
      payload: { failure_count: 2 },
      feedback: [
        { summary: '第一次反馈', issues_found: [] },
        { summary: '第二次反馈', issues_found: [] }
      ]
    });
    expect(result).toContain('第二次反馈');
    expect(result).not.toContain('第一次反馈');
  });

  it('DoD-3: feedback 为空数组时不注入 feedback 段', () => {
    const result = buildRetryContext({
      payload: {
        failure_count: 1,
        failure_classification: { class: 'transient' }
      },
      feedback: []
    });
    expect(result).not.toContain('反馈摘要');
  });

  // DoD-4: 两者都有
  it('DoD-4: classification + feedback 同时存在时两段都注入', () => {
    const result = buildRetryContext({
      payload: {
        failure_count: 1,
        failure_classification: {
          class: 'code_error',
          retry_strategy: { reason: 'npm test failed' }
        }
      },
      feedback: [{ summary: '单元测试未通过', issues_found: ['断言失败'] }]
    });
    expect(result).toContain('code_error');
    expect(result).toContain('npm test failed');
    expect(result).toContain('单元测试未通过');
    expect(result).toContain('断言失败');
  });

  // DoD-5: 截断保护
  it('DoD-5: 内容 >2000 字符时截断并加 ...[已截断]', () => {
    const longSummary = 'x'.repeat(3000);
    const result = buildRetryContext({
      payload: {
        failure_count: 1,
        failure_classification: { class: 'code_error' }
      },
      feedback: [{ summary: longSummary, issues_found: [] }]
    });
    expect(result.length).toBeLessThanOrEqual(2000);
    expect(result).toContain('...[已截断]');
  });
});

describe('preparePrompt: 4 条 return 路径都注入 retry context', () => {
  let preparePrompt;

  beforeEach(async () => {
    vi.resetModules();
    const executor = await import('../executor.js');
    preparePrompt = executor.preparePrompt;
  });

  const retryTask = (extra = {}) => ({
    task_type: 'dev',
    title: '测试任务',
    description: '任务描述',
    payload: {
      failure_count: 1,
      failure_classification: { class: 'code_error', retry_strategy: { reason: '测试失败' } }
    },
    feedback: [],
    ...extra
  });

  // DoD-6a: task.prd_content 路径
  it('DoD-6a: task.prd_content 路径注入 retry context', async () => {
    const task = retryTask({ prd_content: '# PRD content' });
    const result = await preparePrompt(task);
    expect(result).toContain('# PRD content');
    expect(result).toContain('code_error');
    expect(result).toContain('重试上下文');
  });

  // DoD-6b: payload.prd_content 路径
  it('DoD-6b: payload.prd_content 路径注入 retry context', async () => {
    const task = retryTask({
      payload: {
        failure_count: 1,
        failure_classification: { class: 'code_error', retry_strategy: { reason: '测试失败' } },
        prd_content: '# payload PRD'
      }
    });
    const result = await preparePrompt(task);
    expect(result).toContain('# payload PRD');
    expect(result).toContain('code_error');
  });

  // DoD-6c: payload.prd_path 路径
  it('DoD-6c: payload.prd_path 路径注入 retry context', async () => {
    const task = retryTask({
      payload: {
        failure_count: 1,
        failure_classification: { class: 'transient', retry_strategy: { reason: '网络超时' } },
        prd_path: '/path/to/prd.md'
      }
    });
    const result = await preparePrompt(task);
    expect(result).toContain('/path/to/prd.md');
    expect(result).toContain('transient');
  });

  // DoD-6d: 自动生成 PRD 路径
  it('DoD-6d: 自动生成 PRD 路径注入 retry context', async () => {
    const task = retryTask();
    const result = await preparePrompt(task);
    expect(result).toContain('/dev');
    expect(result).toContain('code_error');
    expect(result).toContain('重试上下文');
  });

  // 回归：首次执行不注入
  it('回归: 首次执行自动 PRD 路径不注入 retry context', async () => {
    const task = {
      task_type: 'dev',
      title: '首次任务',
      description: '描述',
      payload: { failure_count: 0 },
      feedback: []
    };
    const result = await preparePrompt(task);
    expect(result).not.toContain('重试上下文');
  });
});
