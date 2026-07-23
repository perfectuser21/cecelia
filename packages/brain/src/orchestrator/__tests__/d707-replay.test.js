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

import { derive } from '../derive.js';
import { deriveCounters } from '../counters.js';

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

  it('hop 59+（旧实现的重复 fix）：derive() 在每个重复 trigger_sha 的 observed 中必须输出 mark_failed，不得 spawn:generator-fix', () => {
    // 验证逻辑：对 hop 59-66 的每个旧实现 spawn:generator-fix（错误行为），
    // 用 derive() 检查：当 noProgressSameSha=true 时，不得继续产生 spawn:generator-fix
    const hop57 = D707_FIXTURE.hops.find((h) => h.hop === 57);
    const duplicateFixHops = D707_FIXTURE.hops.filter(
      (h) => h.hop >= 59 && h.action === 'spawn:generator-fix' && h.detail.trigger_sha === hop57?.detail?.trigger_sha
    );

    // fixture 中旧实现有 8 个重复 fix（hop 59-66）
    expect(duplicateFixHops.length).toBeGreaterThan(0); // 确认 fixture 包含旧实现的错误行为

    // 对每个重复 fix hop，构造对应 observed 并用 derive() 验证新实现不会产生 spawn:generator-fix
    for (const dupHop of duplicateFixHops) {
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
          head_sha: dupHop.detail.trigger_sha, // SHA 仍未变
        },
        inflight: { containers: [], host_pids: [] },
        lastAgentExit: { code: 0, auth_failed: false },
        proposeBranchRn: 0,
        ganLatestRoundVerdict: null,
        generatorSpawned: true,
        evaluateVerdict: { verdict: 'PASS', pr_head_sha: dupHop.detail.trigger_sha },
        judgeVerdict: {
          verdict: 'FAIL',
          pr_head_sha: dupHop.detail.trigger_sha,
          failure_class: 'product_failure',
        },
        reviewRequired: false,
        reviewApproved: false,
        // 关键：hop 58 callback 后 noProgressSameSha 已为 true
        noProgressSameSha: true,
        generatorFixTriggerSha: dupHop.detail.trigger_sha,
        generatorFixCompletedSha: dupHop.detail.trigger_sha, // 相同 → no progress
        counters: {
          hops: dupHop.hop,
          fixRound: dupHop.hop - 57, // 大概的 fixRound 数
          pollCount: 0,
          noPushStreak: 0,
          noVerdictStreak: 0,
          ganCostUsd: 0,
        },
      };

      const r = derive(observed);
      // 新实现必须：noProgressSameSha=true → mark_failed，绝对不得 spawn:generator-fix
      expect(r.action).toBe('mark_failed');
      expect(r.action).not.toBe('spawn:generator-fix');
      expect(r.reason).toMatch(/no_progress_same_sha/);
    }
  });
});
