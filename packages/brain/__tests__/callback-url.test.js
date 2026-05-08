import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ENTRYPOINT = resolve(__dirname, '../../../docker/cecelia-runner/entrypoint.sh');

describe('entrypoint.sh callback URL [BEHAVIOR]', () => {
  const code = readFileSync(ENTRYPOINT, 'utf8');

  it('优先用 HARNESS_CALLBACK_URL env（spawnNode 传完整 URL）', () => {
    expect(code).toMatch(/HARNESS_CALLBACK_URL:-/);
  });

  it('TARGET_URL 拼装含 fallback HOSTNAME（兼容老路径）', () => {
    expect(code).toContain('CONTAINER_ID="${HOSTNAME:-');
    expect(code).toMatch(/TARGET_URL="http:\/\/host\.docker\.internal:5221/);
  });

  it('curl 用 TARGET_URL 不再硬编码 ${CONTAINER_ID}', () => {
    expect(code).toMatch(/curl[^"]*"\$TARGET_URL"/s);
  });
});
