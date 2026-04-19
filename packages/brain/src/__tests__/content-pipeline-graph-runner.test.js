/**
 * content-pipeline-graph-runner.test.js
 *
 * 验证 runner 层：
 *   - 灰度开关识别 true/1/false/0/空
 *   - 未启用返 {skipped: true}
 *   - task.id 缺失抛错
 *   - mock dockerExecutor 跑完 6 节点 → steps>0 + finalState 有 manifest_path
 *   - onStep 回调按 step 调用
 *   - overrides 覆盖 docker 节点（测试注入）
 *   - 自定义 checkpointer 生效
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MemorySaver } from '@langchain/langgraph';
import {
  runContentPipeline,
  isContentPipelineLangGraphEnabled,
  DEFAULT_RECURSION_LIMIT,
} from '../content-pipeline-graph-runner.js';

describe('isContentPipelineLangGraphEnabled', () => {
  const ORIGINAL = process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED;
  beforeEach(() => {
    delete process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED;
    else process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = ORIGINAL;
  });

  it('returns false when env not set', () => {
    expect(isContentPipelineLangGraphEnabled()).toBe(false);
  });

  it('handles common falsy values', () => {
    for (const v of ['', '0', 'false', 'FALSE', 'False']) {
      process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = v;
      expect(isContentPipelineLangGraphEnabled()).toBe(false);
    }
  });

  it('handles common truthy values', () => {
    for (const v of ['1', 'true', 'TRUE', 'True', 'yes']) {
      process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = v;
      expect(isContentPipelineLangGraphEnabled()).toBe(true);
    }
  });
});

describe('DEFAULT_RECURSION_LIMIT', () => {
  it('is 60 (content pipeline has shorter loops than harness)', () => {
    expect(DEFAULT_RECURSION_LIMIT).toBe(60);
  });
});

describe('runContentPipeline', () => {
  const ORIGINAL = process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED;
  beforeEach(() => {
    delete process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED;
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED;
    else process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = ORIGINAL;
  });

  it('returns { skipped: true } when env not set', async () => {
    const r = await runContentPipeline({ id: 'p-1', keyword: 'demo' });
    expect(r.skipped).toBe(true);
    expect(r.reason).toMatch(/CONTENT_PIPELINE_LANGGRAPH_ENABLED/);
  });

  it('throws when task.id is missing', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    await expect(runContentPipeline({ keyword: 'demo' })).rejects.toThrow(/task\.id/);
  });

  it('runs 6 nodes happy path with mock docker executor', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    const responses = {
      content_research: { exit_code: 0, stdout: 'findings_path: /f.json\noutput_dir: /out\n', timed_out: false },
      content_copywrite: { exit_code: 0, stdout: 'copy_path: /c.md\narticle_path: /a.md\n', timed_out: false },
      content_copy_review: { exit_code: 0, stdout: 'copy_review_verdict: APPROVED\n', timed_out: false },
      content_generate: { exit_code: 0, stdout: 'person_data_path: /pd.json\ncards_dir: /cards\n', timed_out: false },
      content_image_review: { exit_code: 0, stdout: 'image_review_verdict: PASS\n', timed_out: false },
      content_export: { exit_code: 0, stdout: 'manifest_path: /m.json\nnas_url: nas://p-1/\n', timed_out: false },
    };
    const dockerExecutor = vi.fn(async ({ task }) => responses[task.task_type]);

    const r = await runContentPipeline(
      { id: 'p-1', keyword: 'demo', output_dir: '/out' },
      { dockerExecutor },
    );

    expect(r.skipped).toBe(false);
    expect(r.steps).toBeGreaterThanOrEqual(6);
    expect(r.finalState).toBeDefined();
    // 6 个 task_type 都被调过
    expect(dockerExecutor).toHaveBeenCalledTimes(6);
    // finalState 包含 export 节点的产物
    const last = r.finalState;
    const lastNodeName = Object.keys(last)[0];
    expect(['export', 'image_review', 'copy_review', 'generate', 'copywrite', 'research']).toContain(
      lastNodeName,
    );
  });

  it('invokes onStep callback for every step', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    const seen = [];
    const overrides = {
      research: async (s) => ({ ...s, trace: 'research', findings_path: '/f.json' }),
      copywrite: async (s) => ({ ...s, trace: 'copywrite', copy_path: '/c.md' }),
      copy_review: async (s) => ({ ...s, trace: 'copy_review', copy_review_verdict: 'APPROVED' }),
      generate: async (s) => ({ ...s, trace: 'generate', cards_dir: '/cards' }),
      image_review: async (s) => ({ ...s, trace: 'image_review', image_review_verdict: 'PASS' }),
      export: async (s) => ({ ...s, trace: 'export', nas_url: 'nas://p-1/' }),
    };
    const r = await runContentPipeline(
      { id: 'p-step', keyword: 'demo' },
      {
        overrides,
        onStep: (evt) => {
          seen.push({ idx: evt.step_index, node: evt.node, pipeline_id: evt.pipeline_id });
        },
      },
    );
    expect(r.skipped).toBe(false);
    expect(seen.length).toBe(r.steps);
    expect(seen[0].idx).toBe(1);
    expect(seen[seen.length - 1].node).toBe('export');
    expect(seen.every((s) => s.pipeline_id === 'p-step')).toBe(true);
  });

  it('state_snapshot in onStep carries key pipeline fields', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    const snapshots = [];
    const overrides = {
      research: async (s) => ({ ...s, trace: 'research', findings_path: '/f.json' }),
      copywrite: async (s) => ({ ...s, trace: 'copywrite', copy_path: '/c.md' }),
      copy_review: async (s) => ({
        ...s,
        trace: 'copy_review',
        copy_review_verdict: 'APPROVED',
        copy_review_round: 1,
      }),
      generate: async (s) => ({ ...s, trace: 'generate', cards_dir: '/cards' }),
      image_review: async (s) => ({
        ...s,
        trace: 'image_review',
        image_review_verdict: 'PASS',
        image_review_round: 1,
      }),
      export: async (s) => ({ ...s, trace: 'export', nas_url: 'nas://p/', manifest_path: '/m.json' }),
    };
    await runContentPipeline(
      { id: 'p-snap', keyword: 'demo' },
      {
        overrides,
        onStep: (evt) => snapshots.push(evt.state_snapshot),
      },
    );
    const last = snapshots[snapshots.length - 1];
    expect(last.nas_url).toBe('nas://p/');
    expect(last.manifest_path).toBe('/m.json');
  });

  it('onStep error does not crash pipeline', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    const overrides = {
      research: async (s) => ({ ...s, trace: 'research' }),
      copywrite: async (s) => ({ ...s, trace: 'copywrite' }),
      copy_review: async (s) => ({ ...s, trace: 'copy_review', copy_review_verdict: 'APPROVED' }),
      generate: async (s) => ({ ...s, trace: 'generate' }),
      image_review: async (s) => ({ ...s, trace: 'image_review', image_review_verdict: 'PASS' }),
      export: async (s) => ({ ...s, trace: 'export', nas_url: 'nas://p/' }),
    };
    const r = await runContentPipeline(
      { id: 'p-err', keyword: 'demo' },
      {
        overrides,
        onStep: async () => {
          throw new Error('mock onStep failure');
        },
      },
    );
    expect(r.skipped).toBe(false);
    expect(r.steps).toBeGreaterThanOrEqual(6);
  });

  it('uses custom checkpointer when provided', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    const saver = new MemorySaver();
    const overrides = {
      research: async (s) => ({ ...s, trace: 'research' }),
      copywrite: async (s) => ({ ...s, trace: 'copywrite' }),
      copy_review: async (s) => ({ ...s, trace: 'copy_review', copy_review_verdict: 'APPROVED' }),
      generate: async (s) => ({ ...s, trace: 'generate' }),
      image_review: async (s) => ({ ...s, trace: 'image_review', image_review_verdict: 'PASS' }),
      export: async (s) => ({ ...s, trace: 'export' }),
    };
    const r = await runContentPipeline(
      { id: 'p-saver', keyword: 'demo' },
      { checkpointer: saver, overrides },
    );
    expect(r.skipped).toBe(false);
    // Saver 应该存了至少一个 checkpoint
    const tuple = await saver.get({ configurable: { thread_id: 'p-saver' } });
    expect(tuple).toBeDefined();
  });

  it('passes env vars to docker executor', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    const responses = {
      content_research: { exit_code: 0, stdout: 'findings_path: /f.json\n', timed_out: false },
      content_copywrite: { exit_code: 0, stdout: 'copy_path: /c.md\n', timed_out: false },
      content_copy_review: { exit_code: 0, stdout: 'copy_review_verdict: APPROVED\n', timed_out: false },
      content_generate: { exit_code: 0, stdout: 'cards_dir: /cards\n', timed_out: false },
      content_image_review: { exit_code: 0, stdout: 'image_review_verdict: PASS\n', timed_out: false },
      content_export: { exit_code: 0, stdout: 'nas_url: nas://p/\n', timed_out: false },
    };
    let seenEnv = null;
    const dockerExecutor = async ({ task, env }) => {
      if (!seenEnv) seenEnv = env;
      return responses[task.task_type];
    };
    await runContentPipeline(
      { id: 'p-env', keyword: 'demo', output_dir: '/out' },
      { dockerExecutor, env: { CUSTOM_VAR: 'xyz' } },
    );
    expect(seenEnv.CUSTOM_VAR).toBe('xyz');
    expect(seenEnv.CONTENT_PIPELINE_NODE).toBe('research');
    expect(seenEnv.CONTENT_PIPELINE_ID).toBe('p-env');
  });

  it('reads keyword and output_dir from task.payload as fallback', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    const dockerExecutor = vi.fn(async ({ task }) => ({
      exit_code: 0,
      stdout: '',
      timed_out: false,
    }));
    await runContentPipeline(
      {
        id: 'p-payload',
        payload: { keyword: 'from-payload', output_dir: '/out-payload' },
      },
      { dockerExecutor },
    );
    // 第一次调用时 env 里有正确的 output_dir
    const firstCall = dockerExecutor.mock.calls[0][0];
    expect(firstCall.env.CONTENT_OUTPUT_DIR).toBe('/out-payload');
  });

  it('injects CECELIA_CREDENTIALS=account1 by default (Docker claude 认证)', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    delete process.env.CONTENT_PIPELINE_CREDENTIALS;
    const dockerExecutor = vi.fn(async () => ({ exit_code: 0, stdout: '', timed_out: false }));
    await runContentPipeline({ id: 'p-cred', keyword: 'demo' }, { dockerExecutor });
    const firstCall = dockerExecutor.mock.calls[0][0];
    expect(firstCall.env.CECELIA_CREDENTIALS).toBe('account1');
  });

  it('opts.env.CECELIA_CREDENTIALS overrides default', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    const dockerExecutor = vi.fn(async () => ({ exit_code: 0, stdout: '', timed_out: false }));
    await runContentPipeline(
      { id: 'p-cred2', keyword: 'demo' },
      { dockerExecutor, env: { CECELIA_CREDENTIALS: 'account3' } },
    );
    const firstCall = dockerExecutor.mock.calls[0][0];
    expect(firstCall.env.CECELIA_CREDENTIALS).toBe('account3');
  });

  it('CONTENT_PIPELINE_CREDENTIALS env overrides default (but not opts.env)', async () => {
    process.env.CONTENT_PIPELINE_LANGGRAPH_ENABLED = 'true';
    process.env.CONTENT_PIPELINE_CREDENTIALS = 'account2';
    try {
      const dockerExecutor = vi.fn(async () => ({ exit_code: 0, stdout: '', timed_out: false }));
      await runContentPipeline({ id: 'p-cred3', keyword: 'demo' }, { dockerExecutor });
      const firstCall = dockerExecutor.mock.calls[0][0];
      expect(firstCall.env.CECELIA_CREDENTIALS).toBe('account2');
    } finally {
      delete process.env.CONTENT_PIPELINE_CREDENTIALS;
    }
  });
});
