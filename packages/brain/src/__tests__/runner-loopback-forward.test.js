/**
 * runner-loopback-forward.test.js — bug1 通治层守卫：
 * line-strategist/ci-patrol 等 SKILL.md 硬编码 localhost:5221，
 * 容器内必须有 127.0.0.1:5221 → host.docker.internal:5221 回环转发，
 * 否则所有容器内 Brain API 写库静默失败（issue 219a9efc 零落库）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '../../../..');

describe('runner 镜像回环转发', () => {
  it('Dockerfile 安装 socat', () => {
    const df = readFileSync(path.join(ROOT, 'docker/cecelia-runner/Dockerfile'), 'utf8');
    expect(df).toMatch(/\bsocat\b/);
  });

  it('entrypoint.sh 起 127.0.0.1:5221 → host.docker.internal:5221 转发', () => {
    const ep = readFileSync(path.join(ROOT, 'docker/cecelia-runner/entrypoint.sh'), 'utf8');
    expect(ep).toMatch(/socat\s+TCP-LISTEN:5221/);
    expect(ep).toMatch(/host\.docker\.internal:5221/);
  });

  it('evaluator 起 127.0.0.1:5211 → 宿主 Dashboard 5211 转发', () => {
    const ep = readFileSync(path.join(ROOT, 'docker/cecelia-runner/entrypoint.sh'), 'utf8');
    expect(ep).toMatch(/HARNESS_NODE[^\n]+evaluator/);
    expect(ep).toMatch(/socat\s+TCP-LISTEN:5211/);
    expect(ep).toMatch(/host\.docker\.internal:5211/);
  });
});
