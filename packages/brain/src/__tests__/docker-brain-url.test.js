/**
 * docker-brain-url.test.js — bug1 回归：docker 容器 env 不得默认 localhost:5221
 * bridge 网络容器内 localhost 是容器自己（实测 curl 000），必须 host.docker.internal
 * （--add-host host.docker.internal:host-gateway 已由 docker-executor 注入）。
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import { resolveBrainBaseUrl } from '../docker-executor.js';

describe('resolveBrainBaseUrl', () => {
  it('BRAIN_URL 未设置时默认 host.docker.internal:5221（不是 localhost）', () => {
    expect(resolveBrainBaseUrl({})).toBe('http://host.docker.internal:5221');
  });

  it('BRAIN_URL 显式设置时尊重覆盖', () => {
    expect(resolveBrainBaseUrl({ BRAIN_URL: 'http://10.0.0.5:5221' })).toBe('http://10.0.0.5:5221');
  });
});

describe('executor docker 分支不再硬编码 localhost 默认值', () => {
  it('dockerEnv 构造使用 resolveBrainBaseUrl', () => {
    const src = readFileSync(path.join(__dirname, '../executor.js'), 'utf8');
    // docker 分支（HARNESS_DOCKER_ENABLED）里不允许再出现 localhost:5221 兜底
    const dockerBranch = src.slice(src.indexOf(`HARNESS_DOCKER_ENABLED === 'true'`));
    const dockerEnvBlock = dockerBranch.slice(0, dockerBranch.indexOf('spawnDocker'));
    expect(dockerEnvBlock).toContain('resolveBrainBaseUrl');
    expect(dockerEnvBlock).not.toContain(`'http://localhost:5221'`);
  });
});
