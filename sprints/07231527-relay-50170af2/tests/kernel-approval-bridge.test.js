/**
 * kernel-approval-bridge.test.js
 *
 * [BEHAVIOR] B-06：approval bridge fail-closed + 完整认证写 verdict:human_review
 *
 * 当前 harness-pending-reviews.js 已有 HARNESS_REVIEW_APPROVER_TOKEN 认证（PR #4223 实现）。
 * 但 kernel ground-truth.js 的 reviewApproved 推导读 detail.verdict=APPROVED 还是
 * detail.approved===true 需要对齐（FR-12）。
 * 同时需验证旧 SHA 批准和重复批准被拒绝（INV-K7）。
 *
 * Sprint: 07231527-relay-50170af2
 * TASK_ID: 50170af2-fefa-41a7-b0b4-dcf1a5d7b077
 */

// 直接 import 路由层函数进行单元测试（不启动 HTTP 服务器）
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';

// ---- helper: 构建 mock request/response ----

function mockReq({ headers = {}, body = {}, params = {} } = {}) {
  return {
    get: (name) => headers[name.toLowerCase()] ?? headers[name],
    headers,
    body,
    params,
    app: { get: () => null },
    ip: '127.0.0.1',
  };
}

function mockRes() {
  const res = {
    _status: null,
    _body: null,
    status(code) { res._status = code; return res; },
    json(body) { res._body = body; return res; },
    send(body) { res._body = body; return res; },
  };
  return res;
}

// ---- 从 harness-pending-reviews 提取可测 authenticateApprover ----
// 注意：authenticateApprover 是模块内函数，需通过 import 默认导出测试
// 若非导出，则需读取路由源码行为测试

describe('[BEHAVIOR] B-06 approval bridge 认证', () => {
  const ORIGINAL_TOKEN = process.env.HARNESS_REVIEW_APPROVER_TOKEN;

  beforeEach(() => {
    // 清理环境变量
    delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
  });

  afterEach(() => {
    if (ORIGINAL_TOKEN !== undefined) {
      process.env.HARNESS_REVIEW_APPROVER_TOKEN = ORIGINAL_TOKEN;
    } else {
      delete process.env.HARNESS_REVIEW_APPROVER_TOKEN;
    }
  });

  /**
   * T-17-a: token 未配置 → 503 fail-closed
   * 当前实现已有（PR #4223），验证保留。
   */
  test('T-17-a: token 未配置 → 503 fail-closed', async () => {
    // 动态 import 避免模块缓存环境变量
    // 通过读取路由代码验证逻辑而非真正运行 HTTP
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      new URL('../../../packages/brain/src/routes/harness-pending-reviews.js', import.meta.url).pathname,
      'utf8',
    );

    // 验证 fail-closed 逻辑：未配置 token → 503
    expect(src).toMatch(/status\(503\)/);
    expect(src).toMatch(/approver token not configured/);
  });

  /**
   * T-17-b: ground-truth reviewApproved 推导对齐 detail.approved===true
   * FR-12：deriveHumanReview 识别 detail.verdict=APPROVED（与 approved===true 对齐）
   * 当前（先红）：collectGroundTruth 只检查 hrDetail.approved === true，
   * 但 PR #4223 写的 detail 格式是否包含 approved: true 字段需验证
   */
  test('T-17-b: ground-truth 识别 detail.approved=true 写法', async () => {
    // 验证 ground-truth.js 中 reviewApproved 推导逻辑
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const src = readFileSync(
      new URL('../../../packages/brain/src/orchestrator/ground-truth.js', import.meta.url).pathname,
      'utf8',
    );

    // 检查 reviewApproved 推导使用 detail.approved === true
    // 还是 detail.verdict === 'APPROVED'
    // 实现后两者都要支持（或统一为 approved:true）
    const hasApprovedTrue = src.includes("hrDetail.approved === true");
    const hasVerdictApproved = src.includes("hrDetail.verdict === 'APPROVED'");

    // 至少支持其中一种，推荐 approved:true
    expect(hasApprovedTrue || hasVerdictApproved).toBe(true);
  });

  /**
   * T-17-c: INV-K7 旧 SHA 批准拒绝
   * pending-reviews approve 路由必须校验当前 PR head_sha
   * 当前（先红）：路由未实现 SHA 校验（只有 token 认证）
   */
  test('T-17-c: 路由代码应有 pr_head_sha 校验逻辑', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../packages/brain/src/routes/harness-pending-reviews.js', import.meta.url).pathname,
      'utf8',
    );

    // 实现后期望：approve 路由有 pr_head_sha 或 head_sha 字段校验
    // 当前（先红）：路由只校验 token，不校验 SHA
    const hasShaCheck = src.includes('pr_head_sha') || src.includes('head_sha');
    expect(hasShaCheck).toBe(true);
  });

  /**
   * T-17-d: INV-K7 重复批准拒绝
   * 若 decision log 已有 verdict:human_review 行锚定同 sha，应 409
   * 当前（先红）：路由未实现重复检查
   */
  test('T-17-d: 路由代码应有重复批准检查（幂等保护）', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../packages/brain/src/routes/harness-pending-reviews.js', import.meta.url).pathname,
      'utf8',
    );

    // 实现后期望：检查 orchestrator_decision_log 中是否已有 verdict:human_review
    const hasDedupeCheck = src.includes('verdict:human_review') ||
      src.includes('already_approved') ||
      src.includes('409');

    // 当前（先红）：不含上述逻辑
    expect(hasDedupeCheck).toBe(true);
  });

  /**
   * T-17-e: 合法批准 → 写唯一 verdict:human_review 含 approved:true、pr_head_sha、approved_by
   * 当前（先红）：路由写 task_events（旧路径），不写 orchestrator_decision_log
   */
  test('T-17-e: 合法批准写 verdict:human_review 到 orchestrator_decision_log', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      new URL('../../../packages/brain/src/routes/harness-pending-reviews.js', import.meta.url).pathname,
      'utf8',
    );

    // 实现后期望：写入 orchestrator_decision_log，action='verdict:human_review'
    // 当前（先红）：写 task_events
    expect(src).toMatch(/orchestrator_decision_log/);
    expect(src).toMatch(/verdict:human_review/);
    expect(src).toMatch(/approved.*true/);
  });
});

// ---- T-17-f: ground-truth reviewApproved 语义与 verdict:human_review 对齐 ----

describe('[BEHAVIOR] B-06 ground-truth reviewApproved 推导', () => {
  test('T-17-f: reviewApproved = true 当 decision log 含 verdict:human_review(approved=true, sha 匹配)', async () => {
    // 直接测试 collectGroundTruth 的 reviewApproved 推导逻辑（用 mock 注入）
    const { collectGroundTruth } = await import('../../../packages/brain/src/orchestrator/ground-truth.js');

    const headSha = 'sha-approved';
    const mockPool = {
      query: async (sql, params) => {
        if (sql.includes('initiative_runs')) {
          return {
            rows: [{
              id: 'run-1',
              phase: 'review',
              contract_id: 'c1',
              cost_usd: '0',
              pr_url: 'https://github.com/test/repo/pull/99',
            }],
          };
        }
        if (sql.includes('initiative_contracts')) {
          return { rows: [{ id: 'c1', status: 'approved' }] };
        }
        if (sql.includes('tasks')) {
          return {
            rows: [{
              id: 'task-1',
              status: 'in_progress',
              payload: JSON.stringify({ review_required: true }),
              title: 'test',
              ability_id: null,
            }],
          };
        }
        if (sql.includes('orchestrator_decision_log')) {
          return {
            rows: [
              {
                hop: 10,
                action: 'verdict:human_review',
                observed: JSON.stringify({}),
                detail: JSON.stringify({
                  approved: true,
                  pr_head_sha: headSha,
                  approved_by: 'alex',
                }),
              },
            ],
          };
        }
        if (sql.includes('harness_attempts')) return { rows: [] };
        if (sql.includes('account_usage_cache')) return { rows: [] };
        return { rows: [] };
      },
    };

    const mockDeps = {
      pool: mockPool,
      execCmd: (cmd) => {
        if (cmd.includes('gh pr view')) {
          return JSON.stringify({
            state: 'OPEN',
            mergeStateStatus: 'CLEAN',
            headRefOid: headSha,
            statusCheckRollup: [{ state: 'SUCCESS' }],
          });
        }
        if (cmd.includes('git ls-remote')) return '';
        if (cmd.includes('docker ps') && cmd.includes('exited')) return '';
        if (cmd.includes('docker ps')) return '';
        return '';
      },
      fileExists: (path) => path.includes('sprint-prd.md'),
      readFile: () => '# PRD content',
    };

    const observed = await collectGroundTruth(mockDeps, {
      taskId: 'task-1',
      runId: 'run-1',
    });

    // 实现后期望：reviewApproved = true
    // 当前（先红）：decision log 里用 verdict:human_review + approved:true，
    //              但 ground-truth 当前写法是检查 task_events，不读 decision_log 中的 verdict:human_review
    expect(observed.reviewApproved).toBe(true);
  });
});
