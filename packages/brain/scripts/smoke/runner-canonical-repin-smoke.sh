#!/usr/bin/env bash
# runner-canonical-repin smoke — canonical runner digest / worker 版本 pin 全点互锁冒烟
#
# 2026-08-08 kernel 战役：#4720 绕过 build.sh 重建镜像未同步 pin，fleet 三机准入静默全挂。
# 本冒烟复用 canonical-pin-consistency 守卫（纯文本断言，CI 无 docker 也可跑），
# 并额外断言 node-profile.js 合同导出的三机 profile 均携带 baseline digest。
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"

bash "$ROOT/packages/brain/scripts/fleet-worker/canonical-pin-consistency.test.sh"

cd "$ROOT"
node --input-type=module <<'NODE'
import { readFileSync } from 'node:fs';
import { listNodeProfiles } from './packages/brain/src/orchestrator/fleet-node/node-profile.js';

const src = readFileSync('packages/brain/src/orchestrator/fleet-node/node-profile.js', 'utf8');
const pinned = src.match(/runner_image_digest: '([^']+)'/)?.[1];
if (!/^sha256:[0-9a-f]{64}$/.test(pinned ?? '')) {
  throw new Error('cannot parse runner_image_digest pin from node-profile.js');
}
const profiles = listNodeProfiles();
if (profiles.length !== 3) throw new Error(`expected 3 canonical nodes, got ${profiles.length}`);
for (const profile of profiles) {
  if (profile.runner_image_digest !== pinned) {
    throw new Error(`runner digest drift on ${profile.machine_id}: ${profile.runner_image_digest}`);
  }
}
console.log('runner-canonical-repin smoke OK:', pinned);
NODE
