import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';

describe('work routing validation route schema', () => {
  it('returns valid receipt keys and stable reason_code without ok', async () => {
    const source = await readFile(new URL('../routes/work-routing.js', import.meta.url), 'utf8');
    expect(source).toContain('valid: true');
    expect(source).toContain('routing_receipt_id: receipt.id');
    expect(source).toContain('expires_at:');
    expect(source).toContain("reason_code: 'route_violation'");
    expect(source).not.toMatch(/\bok\s*:/);
  });
});
