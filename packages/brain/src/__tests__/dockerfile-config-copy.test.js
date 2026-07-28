// Regression: kernel bootstrap 曾因镜像缺 /app/config/fleet-node-profiles.json 秒死
// （run 9238e735 failure_reason=kernel_bootstrap_missing_/app/config/fleet-node-profiles.json）。
// node-profile.js 以 ../../../config/ 相对 src/ 解析 → 镜像内必须存在 /app/config/。
// Dockerfile 若不 COPY packages/brain/config/，该目录永远不进镜像。
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const brainRoot = join(dirname(fileURLToPath(import.meta.url)), '../..');

describe('Dockerfile config/ 拷贝（kernel bootstrap 依赖）', () => {
  it('packages/brain/config/fleet-node-profiles.json 存在于仓库', () => {
    expect(existsSync(join(brainRoot, 'config/fleet-node-profiles.json'))).toBe(true);
  });

  it('Dockerfile 将 packages/brain/config/ 拷入镜像 ./config/', () => {
    const dockerfile = readFileSync(join(brainRoot, 'Dockerfile'), 'utf8');
    expect(dockerfile).toMatch(/^COPY\s+packages\/brain\/config\/\s+\.\/config\/\s*$/m);
  });

  it('node-profile.js 解析路径与镜像布局一致（../../../config/ 相对 src/orchestrator/fleet-node/）', () => {
    const source = readFileSync(
      join(brainRoot, 'src/orchestrator/fleet-node/node-profile.js'),
      'utf8',
    );
    expect(source).toContain("'../../../config/fleet-node-profiles.json'");
  });
});
