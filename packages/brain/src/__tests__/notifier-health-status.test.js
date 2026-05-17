// packages/brain/src/__tests__/notifier-health-status.test.js
import { describe, it, expect } from 'vitest';

/**
 * 提取 health endpoint 中 notifier status 判断逻辑为可测单元
 * 直接 inline 逻辑，测三种 env 组合
 */
function getNotifierStatus(env) {
  const status = env.FEISHU_BOT_WEBHOOK
    ? 'configured'
    : (env.FEISHU_APP_ID && env.FEISHU_APP_SECRET && env.FEISHU_OWNER_OPEN_IDS)
      ? 'configured'
      : 'unconfigured';
  const channel = env.FEISHU_BOT_WEBHOOK
    ? 'webhook'
    : (env.FEISHU_APP_ID ? 'open_api' : 'none');
  return { status, channel };
}

describe('notifier health status — 双通道检查', () => {
  it('只有 FEISHU_BOT_WEBHOOK → configured + webhook', () => {
    const result = getNotifierStatus({ FEISHU_BOT_WEBHOOK: 'https://example.com/hook' });
    expect(result).toEqual({ status: 'configured', channel: 'webhook' });
  });

  it('只有 Open API 三件套 → configured + open_api', () => {
    const result = getNotifierStatus({
      FEISHU_APP_ID: 'app_id_xxx',
      FEISHU_APP_SECRET: 'secret_xxx',
      FEISHU_OWNER_OPEN_IDS: 'ou_xxx'
    });
    expect(result).toEqual({ status: 'configured', channel: 'open_api' });
  });

  it('三者都没有 → unconfigured + none', () => {
    const result = getNotifierStatus({});
    expect(result).toEqual({ status: 'unconfigured', channel: 'none' });
  });

  it('Open API 三件套不齐（缺 APP_SECRET）→ unconfigured + open_api channel', () => {
    const result = getNotifierStatus({
      FEISHU_APP_ID: 'app_id_xxx'
      // 缺 FEISHU_APP_SECRET 和 FEISHU_OWNER_OPEN_IDS
    });
    expect(result).toEqual({ status: 'unconfigured', channel: 'open_api' });
  });
});
