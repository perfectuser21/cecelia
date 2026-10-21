import { describe, it, expect, vi } from 'vitest';
import { onboardContact } from './onboard-store.js';

const authorizedEvent = () => ({
  tenant_id: '11111111-1111-4111-8111-111111111111', binding_id: '22222222-2222-4222-8222-222222222222',
  account_id: 'wxid-account', contact_id: 'wxid-contact', event_id: 'friend-event', display_name: '测试好友',
  authorized: true, scope: 'test', authorization_ref: 'test-approval', identity_evidence_sha256: 'a'.repeat(64),
  observed_at: '2026-10-16T08:00:00Z', friendship_status: 'confirmed',
});

describe('好友入档授权输入边界', () => {
  it.each([
    { authorized: false }, { scope: 'production' }, { friendship_status: 'requested' },
    { identity_evidence_sha256: 'a'.repeat(63) }, { observed_at: '2026-10-16T08:00:00' },
    { observed_at: 'invalidZ' }, { contact_id: ' 昵称 ' }, { account_id: '' }, { tenant_id: 'not-a-tenant' },
    { nickname: '同名好友' }, { customer_id: '33333333-3333-4333-8333-333333333333' },
    { persona: '调用方擅自指定人设' },
  ])('非法授权或身份覆盖在任何数据库调用前拒绝：%j', async change => {
    const db = { query: vi.fn(), totalCount: 0, connect: vi.fn() };
    await expect(onboardContact(db, { ...authorizedEvent(), ...change })).rejects.toMatchObject({ code: 'invalid_input' });
    expect(db.query).not.toHaveBeenCalled();
    expect(db.connect).not.toHaveBeenCalled();
  });
});
