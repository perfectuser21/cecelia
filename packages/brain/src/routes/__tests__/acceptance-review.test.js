// acceptance-review.js 的配对单测（lint-test-pairing 配对文件）。
// 端点八场景覆盖在 integration/acceptance-review-closure.integration.test.js（真库）。
// 本文件覆盖 checkReviewClosePermission 纯函数——A15②③⑤ 的权限判据，供 D3 读侧复用。
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { checkReviewClosePermission, REVIEW_ACK_FALLBACK_HOURS } from '../acceptance-review.js';

const OWNER = 'alex';
const SUBMITTERS = ['staff-a', 'staff-b'];

describe('checkReviewClosePermission（A15②③⑤）', () => {
  let savedEnv;
  beforeEach(() => { savedEnv = process.env.ACCEPTANCE_OWNER_IDENTITY; process.env.ACCEPTANCE_OWNER_IDENTITY = OWNER; });
  afterEach(() => { process.env.ACCEPTANCE_OWNER_IDENTITY = savedEnv; });

  it('员工（非发起人非主理人）close → 403', () => {
    const r = checkReviewClosePermission('staff-a', { created_by: 'initiator' }, SUBMITTERS);
    expect(r.status).toBe(403);
  });

  it('发起人在未全员 ack 且未满 24h 时 → 403 带 pending_acks', () => {
    const detail = {
      created_by: 'initiator',
      review_acks: [{ by: 'staff-a' }],
      adjudicated_at: new Date().toISOString(),
    };
    const r = checkReviewClosePermission('initiator', detail, SUBMITTERS);
    expect(r.status).toBe(403);
    expect(r.body.pending_acks).toEqual(['staff-b']);
  });

  it('全员 ack 后发起人可关 → 放行', () => {
    const detail = {
      created_by: 'initiator',
      review_acks: [{ by: 'staff-a' }, { by: 'staff-b' }],
      adjudicated_at: new Date().toISOString(),
    };
    expect(checkReviewClosePermission('initiator', detail, SUBMITTERS)).toBeNull();
  });

  it('零 ack 但距定案满 24h → 兜底放行（防死锁）', () => {
    const past = new Date(Date.now() - (REVIEW_ACK_FALLBACK_HOURS + 1) * 3600_000).toISOString();
    const detail = { created_by: 'initiator', review_acks: [], adjudicated_at: past };
    expect(checkReviewClosePermission('initiator', detail, SUBMITTERS)).toBeNull();
  });

  it('主理人任意时刻可关（不受 ack 闸约束）', () => {
    const detail = { created_by: 'initiator', review_acks: [], adjudicated_at: new Date().toISOString() };
    expect(checkReviewClosePermission(OWNER, detail, SUBMITTERS)).toBeNull();
  });
});
