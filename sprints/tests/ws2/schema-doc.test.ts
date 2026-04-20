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

  // ——————— Round 3 新增 ———————

  it('schema declares properties.iso.format as date-time', () => {
    const schema = JSON.parse(readFileSync(SCHEMA_PATH, 'utf8'));
    // 采纳 Reviewer 建议：Schema 必须用 JSON Schema 的 date-time format
    // 声明 iso 字段，让 Schema 的语义与端点返回的严格 ISO-8601 正则对齐。
    expect(schema.properties.iso.format).toBe('date-time');
  });

  it('README mentions iso/timezone/unix within 30 lines after the /api/brain/time endpoint line', () => {
    const readme = readFileSync(README_PATH, 'utf8');
    const lines = readme.split('\n');
    // 找到 /api/brain/time 首次出现的行号
    const endpointLineIdx = lines.findIndex((l) => l.includes('/api/brain/time'));
    expect(endpointLineIdx).toBeGreaterThanOrEqual(0);
    // 在其后 30 行窗口内搜索三个字段名，拒绝"端点单独提一嘴、
    // 三字段散在文档其他地方偶然命中"的假装文档。
    const windowEnd = Math.min(lines.length, endpointLineIdx + 31);
    const windowText = lines.slice(endpointLineIdx, windowEnd).join('\n');
    expect(windowText).toContain('iso');
    expect(windowText).toContain('timezone');
    expect(windowText).toContain('unix');
  });
});
