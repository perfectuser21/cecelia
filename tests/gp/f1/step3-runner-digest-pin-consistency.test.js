// F1「工厂 · 开发闭环」步骤 3「造完真验」—— 边：canonical runner digest pin 一致性
//
// 2026-08-21 实证：1.273.102 的 canonical 镜像 c8133468 被 docker image prune -af 误清
// （build 全缓存命中使 Created 继承旧层时间戳，逃过 until=24h 保护），rollout 时
// runner_image_contract_invalid 才暴露。digest 是 11 处 pin 的锚——本断言把
// 「代码内 pin 与配置 pin 逐处一致」钉进 CI，任何 repin 漏改一处立刻红。
//
// 按产物闸规矩写在边上：真 import 被改模块 node-profile.js（不 mock）。
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { listNodeProfiles } from '../../../packages/brain/src/orchestrator/fleet-node/node-profile.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const DIGEST_RE = /sha256:[a-f0-9]{64}/;

// 每次 repin 更新此值（钉死当前批次，防 pin 漂移/回退；上一批 eda14cf3 → 本批含
// publisher headRefOid 读滞后重试修复，build head 2c3341a6e，1.273.113）。
const CANONICAL_DIGEST = 'sha256:b3ff98ff69092e4a904e493f23a271054f06bfefe796ea165d98ebc359facbbf';

describe('canonical runner digest pin 一致性', () => {
  it('node-profile 全部节点 pin 同一个 canonical digest', () => {
    const digests = new Set(listNodeProfiles().map((p) => p.runner_image_digest));
    expect(digests.size).toBe(1);
    const [d] = digests;
    expect(d).toMatch(DIGEST_RE);
    expect(d).toBe(CANONICAL_DIGEST);
  });

  it('fleet-node-profiles.json 配置与 node-profile.js 代码 pin 一致', () => {
    const config = JSON.parse(fs.readFileSync(
      path.join(ROOT, 'packages/brain/config/fleet-node-profiles.json'), 'utf8',
    ));
    const codeDigest = listNodeProfiles()[0].runner_image_digest;
    for (const profile of config.profiles) {
      expect(profile.runner_image_digest, `config pin for ${profile.machine_id}`).toBe(codeDigest);
    }
  });

  it('DEFINITION.md 最新版本条目记录的 digest 与代码 pin 一致（repin 留痕完整）', () => {
    const codeDigest = listNodeProfiles()[0].runner_image_digest;
    const definition = fs.readFileSync(path.join(ROOT, 'DEFINITION.md'), 'utf8');
    // 最新一条「重钉」记录必须等于当前代码 pin——防 repin 只改代码不留痕（r36 批次实证补强）
    const noted = definition.match(/重钉为 `(sha256:[a-f0-9]{64})`/);
    expect(noted?.[1], 'DEFINITION 需记录最新重钉 digest').toBe(codeDigest);
  });

  it('rollout / reconcile / installer 脚本 pin 一致（防 repin 漏改）', () => {
    const codeDigest = listNodeProfiles()[0].runner_image_digest;
    for (const rel of [
      'packages/brain/scripts/fleet-worker/fleet-rollout.sh',
      'packages/brain/scripts/fleet-worker/reconcile-fleet-node-baseline.sh',
      'packages/brain/scripts/smoke/provider-neutral-phase4a-node-smoke.sh',
    ]) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      const found = src.match(DIGEST_RE);
      expect(found?.[0], `pin in ${rel}`).toBe(codeDigest);
    }
  });
});
