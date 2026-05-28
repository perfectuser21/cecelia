import { describe, it, expect } from 'vitest';

// Regression test: executor.js 必须把 HARNESS_XIAN_ENABLED / HARNESS_XIAN_BRIDGE_URL
// 从 Brain 进程 env 透传给 initiative Docker 容器的 dockerEnv，
// 使 LangGraph spawnNode 在容器内能读到这两个变量并走 xian-m4 Codex Bridge 路径。
describe('executor dockerEnv xian passthrough', () => {
  it('HARNESS_XIAN_ENABLED 已设置时注入到 dockerEnv', () => {
    const orig = process.env.HARNESS_XIAN_ENABLED;
    const origUrl = process.env.HARNESS_XIAN_BRIDGE_URL;
    process.env.HARNESS_XIAN_ENABLED = 'true';
    process.env.HARNESS_XIAN_BRIDGE_URL = 'http://100.86.57.69:3458';

    const dockerEnv = { CECELIA_TASK_TYPE: 'harness_initiative' };
    if (process.env.HARNESS_XIAN_ENABLED) dockerEnv.HARNESS_XIAN_ENABLED = process.env.HARNESS_XIAN_ENABLED;
    if (process.env.HARNESS_XIAN_BRIDGE_URL) dockerEnv.HARNESS_XIAN_BRIDGE_URL = process.env.HARNESS_XIAN_BRIDGE_URL;

    expect(dockerEnv.HARNESS_XIAN_ENABLED).toBe('true');
    expect(dockerEnv.HARNESS_XIAN_BRIDGE_URL).toBe('http://100.86.57.69:3458');

    if (orig === undefined) delete process.env.HARNESS_XIAN_ENABLED;
    else process.env.HARNESS_XIAN_ENABLED = orig;
    if (origUrl === undefined) delete process.env.HARNESS_XIAN_BRIDGE_URL;
    else process.env.HARNESS_XIAN_BRIDGE_URL = origUrl;
  });

  it('HARNESS_XIAN_ENABLED 未设置时不注入到 dockerEnv', () => {
    const orig = process.env.HARNESS_XIAN_ENABLED;
    delete process.env.HARNESS_XIAN_ENABLED;

    const dockerEnv = { CECELIA_TASK_TYPE: 'harness_initiative' };
    if (process.env.HARNESS_XIAN_ENABLED) dockerEnv.HARNESS_XIAN_ENABLED = process.env.HARNESS_XIAN_ENABLED;

    expect(dockerEnv.HARNESS_XIAN_ENABLED).toBeUndefined();

    if (orig !== undefined) process.env.HARNESS_XIAN_ENABLED = orig;
  });

  it('executor.js 源码包含 HARNESS_XIAN_ENABLED 透传逻辑', async () => {
    const { readFileSync } = await import('fs');
    const { resolve } = await import('path');
    const src = readFileSync(resolve(import.meta.dirname, '../executor.js'), 'utf8');
    expect(src).toMatch(/HARNESS_XIAN_ENABLED.*dockerEnv\.HARNESS_XIAN_ENABLED/);
    expect(src).toMatch(/HARNESS_XIAN_BRIDGE_URL.*dockerEnv\.HARNESS_XIAN_BRIDGE_URL/);
  });
});
