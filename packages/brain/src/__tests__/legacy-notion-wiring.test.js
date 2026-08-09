import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('legacy Notion push production wiring', () => {
  it('server delegates legacy scheduling to the opt-in gate', () => {
    const server = readFileSync(new URL('../../server.js', import.meta.url), 'utf8');
    expect(server).toContain('scheduleLegacyNotionPush');
    expect(server).toContain('scheduleLegacyNotionPush(pool)');
    expect(server).not.toMatch(/setInterval\(async \(\) => \{\s*try \{ await runNotionPushSync\(pool\)/);
  });
});
