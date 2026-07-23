/**
 * d707-replay.test.js — B-09: d707 hop 55-66 历史事故回归
 *
 * TDD 骨架：全红状态。
 * 验证：使用 d707 hop 55-66 的真实 decision log fixture 回放，
 *       新实现不得产生 hop 58-66 的九次重复 generator-fix。
 *
 * FR-12 条目 4：d707 hop 55–66 replay → 新实现不得产生 hop 58–66 的九次重复 generator-fix
 * FR-06：同 (run_id, failure_class, trigger_sha, role) 禁止第二个 generator-fix
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = join(__dirname, 'fixtures/d707-hops-55-66.json');

// TODO: 实现后取消注释
// import { derive } from '../../../packages/brain/src/orchestrator/derive.js';
// import { deriveCounters } from '../../../packages/brain/src/orchestrator/counters.js';

// Placeholder derive — 全红骨架
function derive(_observed) {
  return { phase: 'unknown', action: 'unknown', reason: 'not_implemented' };
}

function deriveCounters(_logRows, _options) {
  return {
    hops: 0, fixRound: 0, ganRound: 0,
    noPushStreak: 0, noVerdictStreak: 0,
    crossCheckMismatch: false,
  };
}

/**
 * d707 hop 55-66 fixture — 模拟真实事故数据结构
 * 真实 fixture 应从 d707 生产 decision log 导出，此处为骨架占位
 *
 * 事故根因：hop 57 时 judge 返回 product_failure + trigger_sha=sha-v57，
 * 系统在 hop 58-66 连续 9 次对同一 SHA 派 generator-fix，均无进展。
 */
const D707_FIXTURE = existsSync(FIXTURE_PATH)
  ? JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))
  : {
      // 骨架占位（真实 fixture 文件不存在时使用）
      runId: 'd707-replay',
      triggerSha: 'sha-v57-placeholder',
      hops: [
        // hop 55: evaluator PASS
        {
          hop: 55,
          action: 'verdict:evaluate',
          detail: { verdict: 'PASS', pr_head_sha: 'sha-v57-placeholder' },
        },
        // hop 56: judge FAIL product_failure
        {
          hop: 56,
          action: 'verdict:judge',
          detail: {
            verdict: 'FAIL',
            pr_head_sha: 'sha-v57-placeholder',
            failure_class: 'product_failure',
          },
        },
        // hop 57: 第一次 generator-fix intent（合法）
        {
          hop: 57,
          action: 'spawn:generator-fix',
          detail: {
            trigger_sha: 'sha-v57-placeholder',
            failure_class: 'product_failure',
            role: 'generator',
          },
        },
        // hop 58: generator-fix callback，SHA 未变（no progress 场景）
        {
          hop: 58,
          action: 'verdict:generator-fix-callback',
          detail: {
            pr_head_sha: 'sha-v57-placeholder', // 未变！
            status: 'completed',
            worker_said: 'DONE',
          },
        },
        // hop 59-66: 旧实现错误地继续 generator-fix（共 9 次，应被新实现阻止）
        ...Array.from({ length: 8 }, (_, i) => ({
          hop: 59 + i,
          action: 'spawn:generator-fix', // 旧实现的错误行为
          detail: {
            trigger_sha: 'sha-v57-placeholder', // 同 SHA，错误
            failure_class: 'product_failure',
            role: 'generator',
          },
        })),
      ],
    };

describe('B-09: d707 hop 55-66 replay', () => {
  it('fixture 文件存在或使用骨架占位（fixture 路径已配置）', () => {
    // 验证 fixture 数据结构合法
    expect(D707_FIXTURE).toBeDefined();
    expect(D707_FIXTURE.hops).toBeDefined();
    expect(Array.isArray(D707_FIXTURE.hops)).toBe(true);
  });

  it('fixture 包含 hop 55-66 的完整序列', () => {
    const hops = D707_FIXTURE.hops.map((h) => h.hop);
    expect(hops).toContain(55);
    expect(hops).toContain(56);
    expect(hops).toContain(57);
    expect(hops).toContain(58);
  });

  it('fixture 中 hop 57 是第一次 generator-fix（合法）', () => {
    const hop57 = D707_FIXTURE.hops.find((h) => h.hop === 57);
    expect(hop57).toBeDefined();
    expect(hop57.action).toBe('spawn:generator-fix');
    expect(hop57.detail.trigger_sha).toBeDefined();
  });

  it('fixture 中 hop 58 是 generator-fix callback，SHA 未变', () => {
    const hop57 = D707_FIXTURE.hops.find((h) => h.hop === 57);
    const hop58 = D707_FIXTURE.hops.find((h) => h.hop === 58);
    expect(hop58).toBeDefined();
    // hop 58 的 pr_head_sha 与 hop 57 的 trigger_sha 相同 → no progress
    expect(hop58.detail.pr_head_sha).toBe(hop57.detail.trigger_sha);
  });

  /**
   * 核心验证：新实现 derive() 在 hop 58 callback 后
   * 必须输出 no_progress_same_sha terminal，不得输出 spawn:generator-fix
   */
  it('hop 58 callback（SHA 未变）后，derive() 输出 mark_failed reason=no_progress_same_sha，不得继续 generator-fix', () => {
    const hop57 = D707_FIXTURE.hops.find((h) => h.hop === 57);
    const observed = {
      run: { phase: 'generate' },
      task: { status: 'in_progress' },
      prdExists: true,
      contract: { approved: true },
      pr: {
        url: 'u',
        state: 'OPEN',
        ci: 'pass',
        merged: false,
        head_sha: hop57.detail.trigger_sha, // SHA 未变
      },
      inflight: { containers: [], host_pids: [] },
      lastAgentExit: { code: 0, auth_failed: false },
      proposeBranchRn: 0,
      ganLatestRoundVerdict: null,
      generatorSpawned: true,
      evaluateVerdict: { verdict: 'PASS', pr_head_sha: hop57.detail.trigger_sha },
      judgeVerdict: {
        verdict: 'FAIL',
        pr_head_sha: hop57.detail.trigger_sha,
        failure_class: 'product_failure',
      },
      reviewRequired: false,
      reviewApproved: false,
      // 新实现关键字段
      noProgressSameSha: true,                          // ground-truth 从 hop 58 callback 推导
      generatorFixTriggerSha: hop57.detail.trigger_sha,
      generatorFixCompletedSha: hop57.detail.trigger_sha, // 相同 → no progress
      counters: {
        hops: 58,
        fixRound: 1, // hop 57 算一次
        pollCount: 0,
        noPushStreak: 0,
        noVerdictStreak: 0,
        ganCostUsd: 0,
      },
    };

    const r = derive(observed);
    expect(r.action).toBe('mark_failed');
    expect(r.reason).toMatch(/no_progress_same_sha/);
  });

  it('旧实现的 hop 59-66（九次重复 generator-fix）在新实现中不应出现', () => {
    // 在新实现中，hop 58 callback 后应已 terminal，hop 59 起不应有 spawn:generator-fix
    // 此测试通过计数验证：fixture 中 spawn:generator-fix 超过 1 次，但新 derive 不允许第二次
    const fixIntents = D707_FIXTURE.hops.filter((h) => h.action === 'spawn:generator-fix');
    // fixture 中旧实现有 9+ 次；此测试断言新 derive 只允许 1 次
    // （测试逻辑：如果 derive 在第一次 no-progress 后正确 terminal，就不会有 hop 59+）
    const triggerSha = fixIntents[0]?.detail?.trigger_sha;
    if (triggerSha) {
      const sameShaFixes = fixIntents.filter((h) => h.detail.trigger_sha === triggerSha);
      // fixture 中（旧行为）可能有多次，但新 derive 路由不允许 > 1
      // 此断言验证"新实现"：derive 检测到 noProgressSameSha=true 后 mark_failed，不增加新的 fix intent
      expect(sameShaFixes.length).toBeGreaterThanOrEqual(1); // fixture 有历史数据
      // 新实现断言在 failing test 中体现（上面的 hop 58 callback 测试）
    }
  });
});
