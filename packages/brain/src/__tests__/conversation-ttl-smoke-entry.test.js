import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

describe('已退役的议题对话 TTL smoke', () => {
  it('不再提供旧 smoke 入口，避免在无隔离的环境复活已退役任务', () => {
    const smoke = fileURLToPath(new URL('../../scripts/smoke/conversation-ttl-archiver-smoke.sh', import.meta.url));
    expect(existsSync(smoke)).toBe(false);
  });
});
