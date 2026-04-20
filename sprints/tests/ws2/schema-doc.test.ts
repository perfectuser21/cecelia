import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

const SCHEMA_PATH = join(
  __dirname,
  '..',
  '..',
  '..',
  'packages',
  'brain',
  'src',
  'contracts',
  'time-response.schema.json',
);

const README_PATH = join(__dirname, '..', '..', '..', 'docs', 'current', 'README.md');

describe('Workstream 2 — Schema & Doc Contract [BEHAVIOR]', () => {
  it('schema file is valid JSON with object type and additionalProperties false', () => {
    const raw = readFileSync(SCHEMA_PATH, 'utf8');
    const schema = JSON.parse(raw);
    expect(schema.type).toBe('object');
    expect(schema.additionalProperties).toBe(false);
  });

  it('schema requires exactly iso, timezone, unix', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    const required = (schema.required || []).slice().sort();
    expect(required).toEqual(['iso', 'timezone', 'unix']);
  });

  it('schema declares correct field types (string/string/integer)', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    expect(schema.properties).toBeDefined();
    expect(schema.properties.iso.type).toBe('string');
    expect(schema.properties.timezone.type).toBe('string');
    expect(schema.properties.unix.type).toBe('integer');
  });

  it('README documents /api/brain/time endpoint with all three fields', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    expect(readme).toContain('/api/brain/time');
    expect(readme).toContain('iso');
    expect(readme).toContain('timezone');
    expect(readme).toContain('unix');
  });
});
