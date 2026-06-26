/**
 * staging-verify.sh 在生产 brain 容器内跑，STAGING_URL 必须用 host.docker.internal（env 可覆盖），
 * 不能用纯 localhost（容器内 localhost 不通 staging 容器）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, '../../../../scripts/staging-verify.sh');

describe('staging-verify.sh STAGING_URL', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  it('STAGING_URL 默认用 host.docker.internal（env STAGING_HOST 可覆盖）', () => {
    const line = (src.match(/STAGING_URL=.*/) || [''])[0];
    expect(line).toContain('STAGING_HOST');
    expect(line).toContain('host.docker.internal');
  });
});
