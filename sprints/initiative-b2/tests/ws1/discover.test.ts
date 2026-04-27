import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, statSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const SPRINT_DIR = join(HERE, '..', '..');
const REPO_ROOT = join(SPRINT_DIR, '..', '..');

type DiscoverFn = () => {
  initiative_id: string;
  title: string;
  description: string;
  status: string;
};

let discoverModule: Record<string, unknown> | null = null;
let importError: unknown = null;

beforeAll(async () => {
  try {
    discoverModule = (await import('../../discover.mjs')) as Record<string, unknown>;
  } catch (err) {
    importError = err;
  }
});

function getDiscover(): DiscoverFn {
  if (importError) {
    throw new Error(
      `discover.mjs failed to import: ${importError instanceof Error ? importError.message : String(importError)}`,
    );
  }
  if (!discoverModule || typeof discoverModule.discoverInitiativeB2 !== 'function') {
    throw new Error('discover.mjs does not export a function named discoverInitiativeB2');
  }
  return discoverModule.discoverInitiativeB2 as DiscoverFn;
}

function snapshotDir(dir: string): Map<string, number> {
  const map = new Map<string, number>();
  function walk(p: string) {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const child = join(p, entry.name);
      if (entry.isDirectory()) {
        walk(child);
      } else if (entry.isFile()) {
        const st = statSync(child);
        map.set(child, st.mtimeMs);
      }
    }
  }
  walk(dir);
  return map;
}

describe('Workstream 1 — discoverInitiativeB2 [BEHAVIOR]', () => {
  it('exports a named function discoverInitiativeB2', () => {
    expect(importError, `import error: ${importError}`).toBeNull();
    expect(discoverModule).not.toBeNull();
    expect(discoverModule).toHaveProperty('discoverInitiativeB2');
    expect(typeof (discoverModule as Record<string, unknown>).discoverInitiativeB2).toBe('function');
  });

  it('returns an object with all four required fields as strings', () => {
    const fn = getDiscover();
    const result = fn();
    expect(result).toBeTypeOf('object');
    expect(result).not.toBeNull();
    for (const key of ['initiative_id', 'title', 'description', 'status'] as const) {
      expect(typeof result[key]).toBe('string');
      expect((result[key] as string).length).toBeGreaterThan(0);
    }
  });

  it('returns status equal to "active"', () => {
    const fn = getDiscover();
    const result = fn();
    expect(result.status).toBe('active');
  });

  it('returns description with length >= 60', () => {
    const fn = getDiscover();
    const result = fn();
    expect(result.description.length).toBeGreaterThanOrEqual(60);
  });

  it('returns initiative_id containing "B2" (case-insensitive)', () => {
    const fn = getDiscover();
    const result = fn();
    expect(result.initiative_id).toMatch(/B2/i);
  });

  it('is idempotent — two consecutive calls return deeply equal objects', () => {
    const fn = getDiscover();
    const r1 = fn();
    const r2 = fn();
    expect(r1).toEqual(r2);
    expect(r1).not.toBe(r2);
  });

  it('has no filesystem side effects on call', () => {
    const fn = getDiscover();
    const before = snapshotDir(REPO_ROOT);
    fn();
    fn();
    const after = snapshotDir(REPO_ROOT);
    expect(after.size).toBe(before.size);
    for (const [path, mtime] of after) {
      expect(before.has(path)).toBe(true);
      expect(before.get(path)).toBe(mtime);
    }
    expect(existsSync(REPO_ROOT)).toBe(true);
  });
});
