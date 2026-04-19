/**
 * content-pipeline-graph-docker.test.js
 *
 * 验证 createContentDockerNodes 工厂：
 *   - 每节点 prompt 包含 skill content + input_ref 字段（路径）
 *   - prompt 不包含前面节点的文本输出（token 不累积验证）
 *   - dockerExecutor 被调用时 env 正确
 *   - verdict 解析：APPROVED/REVISION/PASS/FAIL
 *   - 产物路径从 stdout 提取正确
 *   - 完整 graph 能 mock-run 到 export
 */
import { describe, it, expect } from 'vitest';
import {
  createContentDockerNodes,
  compileContentPipelineApp,
  buildNodeInputPrompt,
  NODE_CONFIGS,
} from '../content-pipeline-graph.js';

describe('createContentDockerNodes', () => {
  const mockTask = { id: 'task-1', payload: {} };

  /**
   * 帮助：mock executor 记录所有调用
   */
  function makeRecordingExecutor(responses) {
    const calls = [];
    const executor = async ({ task, prompt, env }) => {
      calls.push({ task_type: task.task_type, prompt, env });
      const taskType = task.task_type;
      return (
        responses[taskType] || { exit_code: 0, stdout: '', stderr: '', timed_out: false }
      );
    };
    return { executor, calls };
  }

  it('exposes exactly 6 node functions', () => {
    const { executor } = makeRecordingExecutor({});
    const nodes = createContentDockerNodes(executor, mockTask);
    expect(Object.keys(nodes).sort()).toEqual([
      'copy_review',
      'copywrite',
      'export',
      'generate',
      'image_review',
      'research',
    ]);
    for (const name of Object.keys(nodes)) {
      expect(typeof nodes[name]).toBe('function');
    }
  });

  it('research node: prompt has keyword + output_dir, extracts findings_path', async () => {
    const { executor, calls } = makeRecordingExecutor({
      content_research: {
        exit_code: 0,
        stdout: 'findings_path: /tmp/findings.json\noutput_dir: /tmp/out-2026\n',
        stderr: '',
        timed_out: false,
      },
    });
    const nodes = createContentDockerNodes(executor, mockTask);
    const update = await nodes.research({
      pipeline_id: 'p-1',
      keyword: '一人公司',
      output_dir: '',
    });
    expect(calls[0].task_type).toBe('content_research');
    expect(calls[0].prompt).toContain('一人公司');
    expect(calls[0].env.CONTENT_PIPELINE_NODE).toBe('research');
    expect(update.findings_path).toBe('/tmp/findings.json');
    expect(update.output_dir).toBe('/tmp/out-2026');
    expect(update.trace).toBe('research');
    expect(update.error).toBeNull();
  });

  it('copywrite node: prompt has findings_path ref but NOT findings content', async () => {
    const { executor, calls } = makeRecordingExecutor({
      content_copywrite: {
        exit_code: 0,
        stdout: 'copy_path: /tmp/copy.md\narticle_path: /tmp/article.md\n',
        stderr: '',
        timed_out: false,
      },
    });
    const nodes = createContentDockerNodes(executor, mockTask);
    const state = {
      pipeline_id: 'p-1',
      keyword: '一人公司',
      output_dir: '/tmp/out',
      findings_path: '/tmp/findings.json',
    };
    const update = await nodes.copywrite(state);
    const prompt = calls[0].prompt;
    // 路径引用存在
    expect(prompt).toContain('findings_path');
    expect(prompt).toContain('/tmp/findings.json');
    // 但不含文本内容（模拟上游可能塞进来的）
    expect(prompt).not.toContain('some findings content');
    expect(update.copy_path).toBe('/tmp/copy.md');
    expect(update.article_path).toBe('/tmp/article.md');
  });

  it('copy_review node: parses APPROVED verdict', async () => {
    const { executor } = makeRecordingExecutor({
      content_copy_review: {
        exit_code: 0,
        stdout: 'copy_review_verdict: APPROVED\ncopy_review_feedback: null\n',
        stderr: '',
        timed_out: false,
      },
    });
    const nodes = createContentDockerNodes(executor, mockTask);
    const update = await nodes.copy_review({
      pipeline_id: 'p-1',
      copy_path: '/tmp/copy.md',
      article_path: '/tmp/article.md',
      copy_review_round: 0,
    });
    expect(update.copy_review_verdict).toBe('APPROVED');
    expect(update.copy_review_round).toBe(1);
    expect(update.trace).toBe('copy_review');
  });

  it('copy_review node: parses REVISION verdict with feedback', async () => {
    const { executor } = makeRecordingExecutor({
      content_copy_review: {
        exit_code: 0,
        stdout:
          'copy_review_verdict: REVISION\ncopy_review_feedback: 品牌关键词缺失\n',
        stderr: '',
        timed_out: false,
      },
    });
    const nodes = createContentDockerNodes(executor, mockTask);
    const update = await nodes.copy_review({
      copy_path: '/tmp/copy.md',
      copy_review_round: 1,
    });
    expect(update.copy_review_verdict).toBe('REVISION');
    expect(update.copy_review_feedback).toBe('品牌关键词缺失');
    expect(update.copy_review_round).toBe(2);
  });

  it('image_review node: parses PASS verdict', async () => {
    const { executor } = makeRecordingExecutor({
      content_image_review: {
        exit_code: 0,
        stdout: 'image_review_verdict: PASS\nimage_review_feedback: null\n',
        stderr: '',
        timed_out: false,
      },
    });
    const nodes = createContentDockerNodes(executor, mockTask);
    const update = await nodes.image_review({
      cards_dir: '/tmp/cards',
      image_review_round: 0,
    });
    expect(update.image_review_verdict).toBe('PASS');
    expect(update.image_review_round).toBe(1);
  });

  it('image_review node: parses FAIL verdict with feedback (回路反馈)', async () => {
    const { executor, calls } = makeRecordingExecutor({
      content_image_review: {
        exit_code: 0,
        stdout:
          'image_review_verdict: FAIL\nimage_review_feedback: 3 张图有文字溢出\n',
        stderr: '',
        timed_out: false,
      },
    });
    const nodes = createContentDockerNodes(executor, mockTask);
    const update = await nodes.image_review({
      cards_dir: '/tmp/cards',
      image_review_round: 0,
    });
    expect(update.image_review_verdict).toBe('FAIL');
    expect(update.image_review_feedback).toBe('3 张图有文字溢出');
  });

  it('generate node: receives image_review_feedback on FAIL loop', async () => {
    const { executor, calls } = makeRecordingExecutor({
      content_generate: {
        exit_code: 0,
        stdout: 'person_data_path: /tmp/pd.json\ncards_dir: /tmp/cards\n',
        stderr: '',
        timed_out: false,
      },
    });
    const nodes = createContentDockerNodes(executor, mockTask);
    const state = {
      pipeline_id: 'p-1',
      output_dir: '/tmp/out',
      findings_path: '/tmp/findings.json',
      copy_path: '/tmp/copy.md',
      image_review_feedback: '3 张图有文字溢出，收紧 BUDGET',
      image_review_round: 1,
    };
    await nodes.generate(state);
    expect(calls[0].prompt).toContain('3 张图有文字溢出');
    expect(calls[0].prompt).toContain('上一轮 vision 审查反馈');
  });

  it('export node: extracts manifest_path and nas_url', async () => {
    const { executor } = makeRecordingExecutor({
      content_export: {
        exit_code: 0,
        stdout:
          'manifest_path: /tmp/out/manifest.json\nnas_url: /volume1/workspace/vault/zenithjoy-creator/content/p-1/\n',
        stderr: '',
        timed_out: false,
      },
    });
    const nodes = createContentDockerNodes(executor, mockTask);
    const update = await nodes.export({
      pipeline_id: 'p-1',
      output_dir: '/tmp/out',
      cards_dir: '/tmp/out/cards',
    });
    expect(update.manifest_path).toBe('/tmp/out/manifest.json');
    expect(update.nas_url).toMatch(/content\/p-1\/?$/);
  });

  it('node handles docker exit_code != 0 (sets error, does not throw)', async () => {
    const { executor } = makeRecordingExecutor({
      content_research: {
        exit_code: 1,
        stdout: '',
        stderr: 'notebooklm timeout',
        timed_out: false,
      },
    });
    const nodes = createContentDockerNodes(executor, mockTask);
    const update = await nodes.research({ pipeline_id: 'p-1', keyword: 'test' });
    expect(update.error).toContain('exit code 1');
    expect(update.error).toContain('notebooklm timeout');
    expect(update.trace).toBe('research(ERROR)');
  });

  it('node handles docker timeout (sets error)', async () => {
    const { executor } = makeRecordingExecutor({
      content_copywrite: {
        exit_code: null,
        stdout: '',
        stderr: '',
        timed_out: true,
      },
    });
    const nodes = createContentDockerNodes(executor, mockTask);
    const update = await nodes.copywrite({
      pipeline_id: 'p-1',
      findings_path: '/tmp/findings.json',
    });
    expect(update.error).toContain('timeout');
  });
});

describe('buildNodeInputPrompt', () => {
  it('research prompt does NOT carry upstream findings content', () => {
    const prompt = buildNodeInputPrompt(
      'research',
      '# research skill content\n',
      { pipeline_id: 'p-1', keyword: 'test', output_dir: '' },
      'task-1',
    );
    expect(prompt).toContain('# research skill content');
    expect(prompt).toContain('pipeline_id');
    expect(prompt).toContain('test');
  });

  it('copywrite prompt carries findings_path but NOT findings content', () => {
    const prompt = buildNodeInputPrompt(
      'copywrite',
      '# copywrite skill\n',
      {
        pipeline_id: 'p-1',
        keyword: 'test',
        output_dir: '/out',
        findings_path: '/tmp/findings.json',
      },
      'task-1',
    );
    expect(prompt).toContain('findings_path');
    expect(prompt).toContain('/tmp/findings.json');
    // 不应携带 findings.json 的内容
    expect(prompt).not.toContain('{"keyword":');
  });

  it('copywrite with review feedback includes feedback section', () => {
    const prompt = buildNodeInputPrompt(
      'copywrite',
      '# skill',
      {
        pipeline_id: 'p-1',
        keyword: 'test',
        findings_path: '/tmp/f.json',
        copy_review_feedback: '品牌词不够',
        copy_review_round: 1,
      },
      'task-1',
    );
    expect(prompt).toContain('上一轮审查反馈');
    expect(prompt).toContain('品牌词不够');
  });

  it('generate with image review feedback includes feedback section', () => {
    const prompt = buildNodeInputPrompt(
      'generate',
      '# skill',
      {
        pipeline_id: 'p-1',
        output_dir: '/out',
        findings_path: '/tmp/f.json',
        copy_path: '/tmp/c.md',
        image_review_feedback: '文字溢出',
        image_review_round: 1,
      },
      'task-1',
    );
    expect(prompt).toContain('上一轮 vision 审查反馈');
    expect(prompt).toContain('文字溢出');
  });

  it('copy_review prompt contains verdict output contract', () => {
    const prompt = buildNodeInputPrompt(
      'copy_review',
      '# skill',
      { pipeline_id: 'p-1', copy_path: '/tmp/c.md', article_path: '/tmp/a.md' },
      'task-1',
    );
    expect(prompt).toContain('copy_review_verdict');
    expect(prompt).toContain('APPROVED|REVISION');
  });

  it('image_review prompt contains PASS|FAIL verdict', () => {
    const prompt = buildNodeInputPrompt(
      'image_review',
      '# skill',
      { pipeline_id: 'p-1', cards_dir: '/tmp/cards', person_data_path: '/tmp/pd.json' },
      'task-1',
    );
    expect(prompt).toContain('image_review_verdict');
    expect(prompt).toContain('PASS|FAIL');
  });

  it('prompts are roughly bounded size (no cumulative growth)', () => {
    // 模拟走到 export 节点时 state 已经累积所有 path + feedback
    const fullState = {
      pipeline_id: 'p-1',
      keyword: '一人公司',
      output_dir: '/tmp/out',
      findings_path: '/tmp/findings.json',
      copy_path: '/tmp/copy.md',
      article_path: '/tmp/article.md',
      person_data_path: '/tmp/pd.json',
      cards_dir: '/tmp/cards',
      image_review_feedback: 'x'.repeat(5000),  // 模拟大反馈
    };
    const researchPrompt = buildNodeInputPrompt('research', '# r', fullState, 't');
    const exportPrompt = buildNodeInputPrompt('export', '# e', fullState, 't');
    // export 不应该比 research 大 10 倍（没累积前面节点的文本输出）
    // 只因 state 路径字段多，差异应该很小
    expect(exportPrompt.length).toBeLessThan(researchPrompt.length * 3);
  });
});

describe('integration: full graph with docker nodes (mock)', () => {
  it('happy path: 6 nodes with mock docker → reaches export', async () => {
    const responses = {
      content_research: { exit_code: 0, stdout: 'findings_path: /f.json\noutput_dir: /out\n', timed_out: false },
      content_copywrite: { exit_code: 0, stdout: 'copy_path: /c.md\narticle_path: /a.md\n', timed_out: false },
      content_copy_review: { exit_code: 0, stdout: 'copy_review_verdict: APPROVED\n', timed_out: false },
      content_generate: { exit_code: 0, stdout: 'person_data_path: /pd.json\ncards_dir: /cards\n', timed_out: false },
      content_image_review: { exit_code: 0, stdout: 'image_review_verdict: PASS\n', timed_out: false },
      content_export: { exit_code: 0, stdout: 'manifest_path: /m.json\nnas_url: nas://p-1/\n', timed_out: false },
    };
    const executor = async ({ task }) => responses[task.task_type];
    const nodes = createContentDockerNodes(executor, { id: 'task-1' });
    const app = compileContentPipelineApp({ overrides: nodes });
    const final = await app.invoke(
      { pipeline_id: 'p-1', keyword: 'demo' },
      { configurable: { thread_id: 'p-1' } },
    );
    expect(final.trace).toEqual([
      'research', 'copywrite', 'copy_review', 'generate', 'image_review', 'export',
    ]);
    expect(final.findings_path).toBe('/f.json');
    expect(final.copy_path).toBe('/c.md');
    expect(final.cards_dir).toBe('/cards');
    expect(final.nas_url).toBe('nas://p-1/');
  });
});

describe('NODE_CONFIGS', () => {
  it('all 6 nodes have skill + task_type + outputs', () => {
    const names = ['research', 'copywrite', 'copy_review', 'generate', 'image_review', 'export'];
    for (const name of names) {
      expect(NODE_CONFIGS[name]).toBeDefined();
      expect(NODE_CONFIGS[name].skill).toMatch(/^pipeline-/);
      expect(NODE_CONFIGS[name].task_type).toMatch(/^content_/);
      expect(Array.isArray(NODE_CONFIGS[name].outputs)).toBe(true);
    }
  });

  it('copy_review and image_review have verdict config', () => {
    expect(NODE_CONFIGS.copy_review.verdict_values).toEqual(['APPROVED', 'REVISION']);
    expect(NODE_CONFIGS.image_review.verdict_values).toEqual(['PASS', 'FAIL']);
  });
});
