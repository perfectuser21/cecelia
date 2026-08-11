import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const dockerfile = readFileSync(
  path.join(root, 'docker/cecelia-runner/Dockerfile'),
  'utf8',
);

describe('Runner evaluator WebKit runtime contract', () => {
  it('pins Playwright and installs a real WebKit browser with OS dependencies', () => {
    expect(dockerfile).toMatch(/npm\s+install\s+-g\s+playwright@\d+\.\d+\.\d+/);
    expect(dockerfile).toMatch(/playwright\s+install\s+--with-deps\s+webkit/);
  });

  it('uses a shared readable browser path available to the constrained evaluator user', () => {
    expect(dockerfile).toMatch(/PLAYWRIGHT_BROWSERS_PATH=\/ms-playwright/);
    expect(dockerfile).toMatch(/chmod\s+-R\s+a\+rX\s+\/ms-playwright/);
  });
});
