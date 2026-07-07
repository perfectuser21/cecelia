import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(__dirname, '../eval.js'), 'utf8');

describe('eval route — static structure assertions', () => {
  it('exports Router with POST /upload and GET /tasks/:id', () => {
    expect(src).toContain("router.post('/upload'");
    expect(src).toContain("router.get('/tasks/:id'");
  });

  it('requireProxyToken uses timingSafeEqual for constant-time comparison', () => {
    expect(src).toContain('timingSafeEqual');
    expect(src).toContain('X-Eval-Proxy-Token');
  });

  it('upload validates zip magic bytes (PK\\x03\\x04)', () => {
    expect(src).toContain('0x50');
    expect(src).toContain('0x4b');
    expect(src).toContain('0x03');
    expect(src).toContain('0x04');
  });

  it('dedup logic computes SHA256 hash of zip buffer', () => {
    expect(src).toContain("createHash('sha256')");
    expect(src).toContain('zip_hash');
  });

  it('GET /tasks/:id returns task_id, status, report_url, failure_stage fields', () => {
    expect(src).toContain('task_id');
    expect(src).toContain('report_url');
    expect(src).toContain('failure_stage');
  });
});
