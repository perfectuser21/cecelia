import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCHEMA_PATH = resolve(process.cwd(), 'sprints/b1-demo/schema.md');

function readSchema(): string {
  return readFileSync(SCHEMA_PATH, 'utf8');
}

describe('Workstream 1 — schema.md [BEHAVIOR]', () => {
  it('declares module identifier as b1-demo', () => {
    const content = readSchema();
    const match = content.match(/^module:\s*(\S+)\s*$/m);
    expect(match).not.toBeNull();
    expect(match![1]).toBe('b1-demo');
  });

  it('declares semver-compliant version', () => {
    const content = readSchema();
    const match = content.match(/^version:\s*(\S+)\s*$/m);
    expect(match).not.toBeNull();
    expect(match![1]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('lists at least 3 fields under Fields section', () => {
    const content = readSchema();
    const fieldsIdx = content.search(/^##\s+Fields\s*$/m);
    expect(fieldsIdx).toBeGreaterThanOrEqual(0);
    const tail = content.slice(fieldsIdx);
    const nextHeading = tail.slice(1).search(/^##\s+/m);
    const section = nextHeading >= 0 ? tail.slice(0, nextHeading + 1) : tail;
    const bulletLines = section.split('\n').filter(l => /^-\s+\S/.test(l));
    expect(bulletLines.length).toBeGreaterThanOrEqual(3);
  });

  it('rejects empty or single-line stub schema', () => {
    const content = readSchema();
    const lines = content.split('\n');
    expect(lines.length).toBeGreaterThanOrEqual(10);
    expect(content.trim().length).toBeGreaterThan(50);
  });
});
