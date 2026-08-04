import { describe, expect, it, vi } from 'vitest';

import {
  failurePersistenceError,
  redactSecrets,
  sanitizeDiagnostic,
} from './failure-persistence.js';

describe('failure persistence diagnostics', () => {
  it.each([
    ['HARNESS_CALLBACK_TOKEN=callback-secret-123', 'callback-secret-123'],
    ['"KERNEL_FLEET_BRIDGE_TOKEN": "bridge-secret-456"', 'bridge-secret-456'],
    ['{"callback_token":"callback-json-secret"}', 'callback-json-secret'],
    ['shared secret = shared-secret-789', 'shared-secret-789'],
    ["shared_token:'shared-token-json'", 'shared-token-json'],
    ['Bearer bearer-secret-000', 'bearer-secret-000'],
  ])('redacts secret assignment in %s', (diagnostic, secret) => {
    const sanitized = sanitizeDiagnostic(diagnostic);

    expect(sanitized).not.toContain(secret);
    expect(sanitized).toContain('[REDACTED]');
  });

  it('never echoes prefixed secret values in the aggregate message', async () => {
    const error = await failurePersistenceError({
      onFailurePersistenceFailed: vi.fn(async () => {}),
    }, {
      attemptId: 'attempt-secret-test',
      lifecycleCode: 'resume_launch_failed',
      originalError: new Error('HARNESS_CALLBACK_TOKEN=raw-callback-value'),
      persistenceError: new Error('{"KERNEL_FLEET_BRIDGE_TOKEN":"raw-bridge-value"}'),
    });

    expect(error).toBeInstanceOf(AggregateError);
    expect(error.message).not.toContain('raw-callback-value');
    expect(error.message).not.toContain('raw-bridge-value');
    expect(error.message).toContain('[REDACTED]');
  });
});

describe('redactSecrets：只脱敏 secret，不折行不截断（案卷式 GAN P2-4 复审拆分）', () => {
  it('保留换行与超过 2000 字符的长度，只替换 secret 片段', () => {
    const longLine = 'x'.repeat(2500);
    const value = `# heading\n\n${longLine}\n\nBearer bearer-secret-000 leaked`;

    const redacted = redactSecrets(value);

    expect(redacted).toContain('\n');
    expect(redacted.length).toBeGreaterThan(2000);
    expect(redacted).not.toContain('bearer-secret-000');
    expect(redacted).toContain('Bearer [REDACTED]');
  });

  it('sanitizeDiagnostic 仍然折行 + 截断 2000（对既有调用方零影响）', () => {
    const longLine = 'x'.repeat(2500);
    const value = `# heading\n\n${longLine}`;

    const sanitized = sanitizeDiagnostic(value);

    expect(sanitized).not.toContain('\n');
    expect(sanitized.length).toBe(2000);
  });
});
