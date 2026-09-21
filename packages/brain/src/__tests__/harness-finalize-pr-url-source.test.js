/**
 * 完成态闸的 PR 来源：协议两头必须对得上。
 *
 * 0921-0922 连撞三次：任务干完、PR 已合并，回写 completed 却永远被
 * `{"success":true,"accepted":false,"reason":"pr_not_found"}` 挡住，状态停在 blocked。
 *
 * 根因是协议两头对不上：
 *  - `engine-pr-watchdog` 规定的回写是 `PATCH {status:'completed', result:{pr_url}}`
 *  - 而 `finalizeHarnessTask` 只认 `task.pr_url` / `task.payload.pr_url`，
 *    **从不看 result.pr_url**，于是必然落到"按分支名反查 GitHub"的兜底；
 *    而分支名里没有 task 短 id（人起的分支名不带），必然查不到。
 *
 * 外部真相原则不放松：请求里给的 URL 只是**线索**，仍然要 `gh pr view` 核到
 * state=MERGED 才认。线索来自调用方，真相来自 GitHub。
 *
 * 另一半是诚实回执：拒绝时不许再报 `success: true`
 * （issue 9cce296f 那一族——写被丢弃却发成功回执）。
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { finalizeHarnessTask } from '../lib/harness-finalize.js';

const TASK_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const PR = 'https://github.com/perfectuser21/cecelia/pull/5457';

function poolWith(task) {
  return {
    query: vi.fn(async (sql) => {
      if (/FROM tasks WHERE id/.test(sql)) return { rows: [task] };
      if (/evaluator|attempts|runs/i.test(sql)) return { rows: [{ ok: true }] };
      return { rows: [], rowCount: 0 };
    }),
  };
}
const baseTask = {
  id: TASK_ID, status: 'blocked', task_type: 'harness_initiative',
  pr_url: null, payload: { orchestrator: 'skill-relay' },
};

describe('完成态闸认不认请求里带的 pr_url', () => {
  it('请求里给了已合并的 PR → 认（核到 MERGED 才认，不是照单全收）', async () => {
    const ghFn = vi.fn(async (args) => {
      expect(args, ' 应该拿请求里的 URL 去问 GitHub').toContain(PR);
      return JSON.stringify({ state: 'MERGED' });
    });
    const r = await finalizeHarnessTask(TASK_ID, {
      pool: poolWith(baseTask), ghFn, requestedPrUrl: PR,
      hasEvaluatorGateFn: async () => true,
    });
    expect(r.applies).toBe(true);
    expect(r.allow, `被拒了，reason=${r.reason}`).toBe(true);
    expect(ghFn).toHaveBeenCalled();
  });

  it('请求里给的 PR 没合并 → 拒，且 reason 说清是没合并不是找不到', async () => {
    const ghFn = vi.fn(async () => JSON.stringify({ state: 'OPEN' }));
    const r = await finalizeHarnessTask(TASK_ID, {
      pool: poolWith(baseTask), ghFn, requestedPrUrl: PR,
      hasEvaluatorGateFn: async () => true,
    });
    expect(r.allow).toBe(false);
    expect(r.reason).toMatch(/pr_not_merged/);
  });

  it('请求里给的不是合法 GitHub PR URL → 当没给，绝不照单全收', async () => {
    const ghFn = vi.fn(async () => JSON.stringify({ state: 'MERGED' }));
    const r = await finalizeHarnessTask(TASK_ID, {
      pool: poolWith({ ...baseTask, payload: { orchestrator: 'skill-relay' } }),
      ghFn, requestedPrUrl: 'https://evil.example.com/pull/1',
      hasEvaluatorGateFn: async () => true,
    });
    expect(r.allow, '非法 URL 被当成有效 PR 收下了').toBe(false);
  });

  it('task.pr_url 优先于请求值（库里的比调用方自报的可信）', async () => {
    const OWN = 'https://github.com/perfectuser21/cecelia/pull/1';
    const seen = [];
    const ghFn = vi.fn(async (args) => { seen.push(args.join(' ')); return JSON.stringify({ state: 'MERGED' }); });
    await finalizeHarnessTask(TASK_ID, {
      pool: poolWith({ ...baseTask, pr_url: OWN }), ghFn, requestedPrUrl: PR,
      hasEvaluatorGateFn: async () => true,
    });
    expect(seen.join(' '), '应优先核库里的 pr_url').toContain(OWN);
  });
});

/**
 * 诚实回执守卫（机械比对源码，不起 HTTP）。
 *
 * 0921-0922 实证：完成申请被闸拒时，PATCH /tasks/:id 返回
 * `{"success":true,"accepted":false,...}` 且 HTTP 200，而状态根本没变。
 * 调用方只看 success 就会当成写成功了——issue 9cce296f 那一族
 * 「写被丢弃却发成功回执」。
 *
 * HTTP 码保持 200、保留 accepted:false（既有调用方按这个契约判，
 * 见 harness-completion-authority.test.js），只把 success 说成实话。
 */
describe('降级时的回执必须诚实', () => {
  const SRC = readFileSync(
    new URL('../routes/tasks.js', import.meta.url), 'utf8',
  );

  it('success 字段不得在降级时恒为 true', () => {
    const i = SRC.indexOf('...(harnessDemoted ? { accepted: false');
    expect(i, '找不到降级回执那段（文件被重构了？）').toBeGreaterThan(0);
    const around = SRC.slice(Math.max(0, i - 400), i);
    expect(
      /success:\s*true\s*,[\s\S]{0,200}$/.test(around),
      '降级分支上方仍写着 success: true —— 写被丢弃却发成功回执',
    ).toBe(false);
    expect(around).toContain('success: !harnessDemoted');
  });

  it('请求里的 pr_url 必须被取出来传给闸', () => {
    expect(SRC).toContain('req.body?.result?.pr_url');
    expect(SRC).toMatch(/finalizeHarnessTask\(task_id,\s*\{[^}]*requestedPrUrl/);
  });
});
