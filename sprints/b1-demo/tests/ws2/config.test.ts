import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const CONFIG_PATH = resolve(process.cwd(), 'sprints/b1-demo/config.json');
const SCHEMA_PATH = resolve(process.cwd(), 'sprints/b1-demo/schema.md');

function readConfigRaw(): string {
  return readFileSync(CONFIG_PATH, 'utf8');
}

function readSchemaVersion(): string | null {
  const content = readFileSync(SCHEMA_PATH, 'utf8');
  const m = content.match(/^version:\s*(\S+)\s*$/m);
  return m ? m[1] : null;
}

describe('Workstream 2 — config.json [BEHAVIOR]', () => {
  it('parses as valid JSON', () => {
    const raw = readConfigRaw();
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('declares module === b1-demo', () => {
    const parsed = JSON.parse(readConfigRaw());
    expect(parsed.module).toBe('b1-demo');
  });

  it('declares enabled === true', () => {
    const parsed = JSON.parse(readConfigRaw());
    expect(parsed.enabled).toBe(true);
  });

  it('exposes non-empty string entrypoint', () => {
    const parsed = JSON.parse(readConfigRaw());
    expect(typeof parsed.entrypoint).toBe('string');
    expect(parsed.entrypoint.length).toBeGreaterThan(0);
  });

  it('keeps version consistent with schema.md', () => {
    const parsed = JSON.parse(readConfigRaw());
    const schemaVersion = readSchemaVersion();
    expect(schemaVersion).not.toBeNull();
    expect(parsed.version).toBe(schemaVersion);
  });
});
