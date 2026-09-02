// F1「工厂 · 开发闭环」步骤 3 —— 边：fleet runner 镜像 digest 单一钉点一致性
//
// 第 68 批案卷：磁盘治理 prune 误删 runner 镜像，重建后 digest 必须在 canonical
// baseline 与节点档案两处逐位一致——不一致时 fleet 探针 docker unavailable，
// 全部派发 node_not_base_admitted（生产实证）。真 import 被改模块。
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getNodeProfile } from '../../../packages/brain/src/orchestrator/fleet-node/node-profile.js';

const PINNED = 'sha256:74afa123d31ff6eda7b3dff213ecba0ac28e5d8f1b74bc40ade3e71dd635721a';

describe('第68批：runner digest 钉点一致性', () => {
  it('canonical baseline 与三台节点档案的 runner_image_digest 逐位一致', () => {
    for (const machine of ['us-mac-m4', 'xian-mac-m4', 'xian-mac-m1']) {
      const profile = getNodeProfile(machine);
      expect(profile.runner_image_digest).toBe(PINNED);
    }
  });

  it('配置文件与代码基线不允许漂移', () => {
    const config = JSON.parse(readFileSync(new URL('../../../packages/brain/config/fleet-node-profiles.json', import.meta.url), 'utf8'));
    for (const p of config.profiles ?? config) {
      if (p.runner_image_digest) expect(p.runner_image_digest).toBe(PINNED);
    }
  });
});
