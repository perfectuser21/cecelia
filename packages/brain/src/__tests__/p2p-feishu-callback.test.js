/**
 * P2P Feishu Callback Tests
 * Tests for sendFeishuToOpenId graceful degradation and P2P callback exports
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Mock fetch globally — notifier uses fetch internally
vi.stubGlobal('fetch', vi.fn());

// vitest runs from packages/brain/, so paths are relative to that
const root = resolve(process.cwd());

describe('sendFeishuToOpenId', () => {
  it('returns false when openId is empty string', async () => {
    const { sendFeishuToOpenId } = await import('../notifier.js');
    const result = await sendFeishuToOpenId('test message', '');
    expect(result).toBe(false);
  });

  it('returns false when openId is null/undefined', async () => {
    const { sendFeishuToOpenId } = await import('../notifier.js');
    expect(await sendFeishuToOpenId('msg', null)).toBe(false);
    expect(await sendFeishuToOpenId('msg', undefined)).toBe(false);
  });

  it('is exported from notifier.js', async () => {
    const mod = await import('../notifier.js');
    expect(typeof mod.sendFeishuToOpenId).toBe('function');
  });
});

describe('orchestrator-chat p2p dispatch keywords', () => {
  it('MOUTH_SYSTEM_PROMPT includes dispatch_query_task', () => {
    const src = readFileSync(resolve(root, 'src/orchestrator-chat.js'), 'utf8');
    expect(src).toContain('dispatch_query_task');
  });

  it('observeChat call includes conversation_id', () => {
    const src = readFileSync(resolve(root, 'src/orchestrator-chat.js'), 'utf8');
    expect(src).toContain('conversation_id');
  });
});

describe('thalamus p2p dispatch support', () => {
  it('thalamus.js handles dispatch_query_task signal', () => {
    const src = readFileSync(resolve(root, 'src/thalamus.js'), 'utf8');
    expect(src).toContain('dispatch_query_task');
  });
});

describe('execution.js p2p callback', () => {
  it('execution.js checks p2p_callback on completion', () => {
    const src = readFileSync(resolve(root, 'src/routes/execution.js'), 'utf8');
    expect(src).toContain('p2p_callback');
  });
});
