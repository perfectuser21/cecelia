import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = resolve(__dirname, '../../..');
const BRAIN_DIR = resolve(REPO_ROOT, 'packages/brain');
const BRAIN_TESTS_DIR = resolve(BRAIN_DIR, 'src/__tests__');
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'archive', 'coverage', '.next', 'sprints']);

function* walkMarkdown(root: string): Generator<string> {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') && entry.name !== '.') continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const fp = join(root, entry.name);
    if (entry.isDirectory()) {
      yield* walkMarkdown(fp);
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      yield fp;
    }
  }
}

function findHealthTestFile(): string | null {
  if (!existsSync(BRAIN_TESTS_DIR)) return null;
  const entries = readdirSync(BRAIN_TESTS_DIR);
  for (const name of entries) {
    if (!/health.*\.test\.(js|ts|cjs|mjs)$/.test(name)) continue;
    const fp = join(BRAIN_TESTS_DIR, name);
    if (!statSync(fp).isFile()) continue;
    const content = readFileSync(fp, 'utf8');
    if (content.includes('/api/brain/health')) return fp;
  }
  return null;
}

function findEndpointDocFile(): string | null {
  for (const md of walkMarkdown(REPO_ROOT)) {
    const rel = relative(REPO_ROOT, md);
    if (rel.startsWith('sprints/')) continue;
    if (rel === 'DEFINITION.md') continue;
    const c = readFileSync(md, 'utf8');
    if (
      c.includes('/api/brain/health') &&
      c.includes('status') &&
      c.includes('uptime_seconds') &&
      c.includes('version')
    ) {
      return md;
    }
  }
  return null;
}

describe('Workstream 4 — Docs + In-Project Test Suite [BEHAVIOR]', () => {
  it('a documentation file (outside sprints/ and DEFINITION.md) lists /api/brain/health together with all three field names', () => {
    const matchedFile = findEndpointDocFile();
    expect(matchedFile, 'expected a non-sprint, non-DEFINITION markdown to document the new endpoint with all three field names').not.toBeNull();
  });

  it('packages/brain/src/__tests__/ has a *health*.test.{js,ts} file that references /api/brain/health', () => {
    const fp = findHealthTestFile();
    expect(fp, 'expected a health-named test file in packages/brain/src/__tests__/ to literally reference /api/brain/health').not.toBeNull();
  });

  it('that test file declares at least 3 it() blocks and imports supertest', () => {
    const fp = findHealthTestFile();
    expect(fp).not.toBeNull();
    const content = readFileSync(fp as string, 'utf8');
    const itBlocks = content.match(/\bit\s*\(/g) ?? [];
    expect(itBlocks.length).toBeGreaterThanOrEqual(3);
    expect(/from\s+['"]supertest['"]/.test(content) || /require\(['"]supertest['"]\)/.test(content)).toBe(true);
  });

  it('running the in-project health test file via vitest exits with code 0', () => {
    const fp = findHealthTestFile();
    expect(fp).not.toBeNull();
    const rel = (fp as string).replace(BRAIN_DIR + '/', '');
    const result = spawnSync(
      'npx',
      ['vitest', 'run', '--reporter=basic', rel],
      { cwd: BRAIN_DIR, encoding: 'utf8', timeout: 90_000 },
    );
    expect(result.status).toBe(0);
  }, 120_000);
});
