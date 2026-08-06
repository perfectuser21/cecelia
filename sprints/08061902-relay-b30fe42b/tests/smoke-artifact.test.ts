import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ARTIFACT_PATH = resolve(HERE, '../smoke-artifact.json');
const EXPECT_TASK_ID = 'b30fe42b-86c7-412e-9e05-eb08ac26488e';
const EXPECT_SMOKE_TAG = 'claude-headed-dispatch-local-31156-4267';
const EXPECT_MODE = 'headed';

function loadArtifact(): Record<string, unknown> {
  return JSON.parse(readFileSync(ARTIFACT_PATH, 'utf8'));
}

describe('smoke-artifact [BEHAVIOR]', () => {
  it('smoke-artifact.json 存在且为合法 JSON 对象', () => {
    const o = loadArtifact();
    expect(typeof o).toBe('object');
    expect(o).not.toBeNull();
    expect(Array.isArray(o)).toBe(false);
  });

  it('task_id 字面等于 b30fe42b-86c7-412e-9e05-eb08ac26488e', () => {
    expect(loadArtifact().task_id).toBe(EXPECT_TASK_ID);
  });

  it('smoke_tag 字面等于 claude-headed-dispatch-local-31156-4267', () => {
    expect(loadArtifact().smoke_tag).toBe(EXPECT_SMOKE_TAG);
  });

  it('mode 字面等于 headed', () => {
    expect(loadArtifact().mode).toBe(EXPECT_MODE);
  });

  it('顶层 keys 完全等于 mode,smoke_tag,task_id', () => {
    expect(Object.keys(loadArtifact()).sort()).toEqual(['mode', 'smoke_tag', 'task_id']);
  });

  it('篡改 smoke_tag 后同一断言必失败', () => {
    const tampered = { ...loadArtifact(), smoke_tag: 'tampered' };
    expect(tampered.smoke_tag === EXPECT_SMOKE_TAG).toBe(false);
  });
});
