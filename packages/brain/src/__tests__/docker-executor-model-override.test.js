/**
 * docker-executor-model-override.test.js
 *
 * P0-3：验证 buildDockerArgs 透传 opts.model → env CLAUDE_MODEL_OVERRIDE。
 * entrypoint.sh 读取此 env 给 claude CLI 加 `--model <value>`，让 content
 * pipeline 的 copy_review 节点能切到 haiku 降成本（Opus 单次 ~$0.96 →
 * Haiku 量级便宜 10-20x）。
 *
 * 覆盖：
 *  - opts.model = 'haiku' → envFinal.CLAUDE_MODEL_OVERRIDE = 'haiku'
 *  - 完整模型名（claude-haiku-4-5-20251001）照样透传
 *  - 不传 model → 不注入 CLAUDE_MODEL_OVERRIDE（走容器默认）
 *  - opts.env.CLAUDE_MODEL_OVERRIDE 优先级高于 opts.model
 *  - 透传成 -e KEY=VAL 形式出现在 args 里
 *
 * 跟上游节点：content-pipeline-graph.js::createContentDockerNodes 的
 * runDockerNode 调 dockerExecutor 时传 `model: cfg.model`，其中
 * NODE_CONFIGS.copy_review.model = 'haiku'。
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('../db.js', () => ({ default: { query: vi.fn() } }));

const { buildDockerArgs } = (await import('../docker-executor.js')).__test__;

describe('buildDockerArgs — P0-3 model override', () => {
  const task = { id: 'aaaa-1', task_type: 'content_copy_review' };
  const baseOpts = { task, prompt: 'hi', worktreePath: '/tmp/wt' };

  it('opts.model=haiku → envFinal.CLAUDE_MODEL_OVERRIDE=haiku', () => {
    const { envFinal, args } = buildDockerArgs(
      { ...baseOpts, model: 'haiku' },
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(envFinal.CLAUDE_MODEL_OVERRIDE).toBe('haiku');
    // docker run 命令里也能看到 -e CLAUDE_MODEL_OVERRIDE=haiku
    expect(args).toContain('-e');
    expect(args).toContain('CLAUDE_MODEL_OVERRIDE=haiku');
  });

  it('opts.model=完整模型名 照样透传', () => {
    const { envFinal } = buildDockerArgs(
      { ...baseOpts, model: 'claude-haiku-4-5-20251001' },
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(envFinal.CLAUDE_MODEL_OVERRIDE).toBe('claude-haiku-4-5-20251001');
  });

  it('opts.model=opus / sonnet 也能透传（不锁死只能用 haiku）', () => {
    for (const alias of ['opus', 'sonnet', 'haiku']) {
      const { envFinal } = buildDockerArgs(
        { ...baseOpts, model: alias },
        { homedir: '/home/fake', existsSyncFn: () => false },
      );
      expect(envFinal.CLAUDE_MODEL_OVERRIDE).toBe(alias);
    }
  });

  it('不传 model → 不注入 CLAUDE_MODEL_OVERRIDE（走容器默认模型）', () => {
    const { envFinal, args } = buildDockerArgs(
      baseOpts,
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(envFinal.CLAUDE_MODEL_OVERRIDE).toBeUndefined();
    expect(args.join(' ')).not.toContain('CLAUDE_MODEL_OVERRIDE');
  });

  it('空字符串 model → 不注入（不给 claude --model "" 的空值）', () => {
    const { envFinal } = buildDockerArgs(
      { ...baseOpts, model: '' },
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(envFinal.CLAUDE_MODEL_OVERRIDE).toBeUndefined();
  });

  it('opts.env.CLAUDE_MODEL_OVERRIDE 优先级高于 opts.model', () => {
    // 允许调用方直接用 env 的方式 override（例如手动跑 pipeline 时临时切）。
    const { envFinal } = buildDockerArgs(
      {
        ...baseOpts,
        model: 'haiku',
        env: { CLAUDE_MODEL_OVERRIDE: 'sonnet' },
      },
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(envFinal.CLAUDE_MODEL_OVERRIDE).toBe('sonnet');
  });

  it('非字符串 model（数字、对象）被 String() 转成字符串', () => {
    // 不会崩；保底转 string，方便上游传什么就透什么。
    const { envFinal } = buildDockerArgs(
      { ...baseOpts, model: 42 },
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(envFinal.CLAUDE_MODEL_OVERRIDE).toBe('42');
  });
});

/**
 * P0#2（2026-06-27 审计）：account-rotation/cascade 选出的模型写在 env CECELIA_MODEL
 * （host bridge cecelia-run.sh 读它），但容器 entrypoint.sh **只读 CLAUDE_MODEL_OVERRIDE** →
 * docker 路径下 rotation/cascade 选的模型被静默丢弃，容器永远跑账号默认模型。
 * buildDockerArgs 必须把 CECELIA_MODEL 桥接成 CLAUDE_MODEL_OVERRIDE。
 */
describe('buildDockerArgs — P0#2 CECELIA_MODEL → CLAUDE_MODEL_OVERRIDE 桥接', () => {
  const task = { id: 'bbbb-2', task_type: 'harness_planner' };
  const baseOpts = { task, prompt: 'hi', worktreePath: '/tmp/wt' };

  it('env.CECELIA_MODEL（rotation 注入）→ 桥接到 CLAUDE_MODEL_OVERRIDE，容器能拿到 --model', () => {
    const { envFinal, args } = buildDockerArgs(
      { ...baseOpts, env: { CECELIA_MODEL: 'opus' } },
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(envFinal.CLAUDE_MODEL_OVERRIDE).toBe('opus');
    expect(args).toContain('CLAUDE_MODEL_OVERRIDE=opus');
  });

  it('CLAUDE_MODEL_OVERRIDE 已显式设 → CECELIA_MODEL 不覆盖（显式优先）', () => {
    const { envFinal } = buildDockerArgs(
      { ...baseOpts, env: { CECELIA_MODEL: 'opus', CLAUDE_MODEL_OVERRIDE: 'haiku' } },
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(envFinal.CLAUDE_MODEL_OVERRIDE).toBe('haiku');
  });

  it('无 CECELIA_MODEL → 不注入（走容器默认）', () => {
    const { envFinal } = buildDockerArgs(
      baseOpts,
      { homedir: '/home/fake', existsSyncFn: () => false },
    );
    expect(envFinal.CLAUDE_MODEL_OVERRIDE).toBeUndefined();
  });
});
