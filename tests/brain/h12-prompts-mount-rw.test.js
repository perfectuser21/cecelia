// SPDX-License-Identifier: MIT
// Test for H12: cecelia-prompts mount 必须 :rw（让 H7 entrypoint tee 真生效）。
// W8 v13 实测：mount :ro 让容器内 tee 写 STDOUT_FILE 失败 → callback stdout 恒空。

import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const DOCKER_EXECUTOR_PATH = path.join(REPO_ROOT, 'packages/brain/src/docker-executor.js');

describe('H12 — cecelia-prompts mount 必须 :rw', () => {
  test('docker-executor.js 含 cecelia-prompts:rw mount，不含 :ro', () => {
    const content = readFileSync(DOCKER_EXECUTOR_PATH, 'utf8');
    expect(content).toContain('cecelia-prompts:rw');
    expect(content).not.toContain('cecelia-prompts:ro');
  });

  test('mount 行格式正确：HOST_PROMPT_DIR:/tmp/cecelia-prompts:rw', () => {
    const content = readFileSync(DOCKER_EXECUTOR_PATH, 'utf8');
    // 必须能匹配到完整 mount 行（含 HOST_PROMPT_DIR + 容器内路径 + :rw）
    expect(content).toMatch(/HOST_PROMPT_DIR.*\/tmp\/cecelia-prompts:rw/);
  });
});
