---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 本机容量三层失真修复（10核16GB→0槽）

**范围**: `collectLocalStats` 本机采集反映宿主真实资源（层①）；`platform-utils` 新增 `macPressureLevelToRatio` 并接线 `fleet-resource-cache` darwin pressure（层②）；`node-profile.getRoleCapacity` 保底消灭 floor 归零死区（层③）。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `platform-utils.js` 导出 `macPressureLevelToRatio`（内核等级→pressure 映射）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/platform-utils.js','utf8');if(!/export\s+function\s+macPressureLevelToRatio/.test(c))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] `fleet-resource-cache.js` 采集侧接线内核 pressure（引用 `getMacOSMemoryPressure`）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/fleet-resource-cache.js','utf8');if(!c.includes('getMacOSMemoryPressure')&&!c.includes('macPressureLevelToRatio'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，内嵌可执行 manual:bash 命令）

- [ ] [BEHAVIOR] [L2] B-01: 层③ proposer(权重2) effective=1 → available≥1（floor 归零死区消灭）
  动作: 调 `getRoleCapacity({baseCapacity:1, role:'proposer'})` 读 .capacity
  预期观察: capacity ≥ 1（现状 floor(1/2)=0，修复后至少 1）
  等待预算: 0s
  留证: node 命令 stdout（OK layer3 available=N）
  Test: manual:bash -c 'node --input-type=module -e "import { getRoleCapacity as g } from \"/workspace/packages/brain/src/orchestrator/fleet-node/node-profile.js\"; const c=g({baseCapacity:1,role:\"proposer\"}).capacity; if(c<1){console.error(\"FAIL capacity=\"+c);process.exit(1)} console.log(\"OK layer3 available=\"+c)"'

- [ ] [BEHAVIOR] [L2] B-02: 层③ 保底不回退不变量 — effective=0 仍不可派 + 权重折算守卫
  动作: 调 `getRoleCapacity` 于 baseCapacity=0(proposer/generator) 与 baseCapacity=8(proposer)
  预期观察: baseCapacity=0 → capacity=0（drained/offline 不复活）；baseCapacity=8,proposer → capacity=4（既有折算不变）
  等待预算: 0s
  留证: node 命令 stdout（OK layer3 invariant）
  Test: manual:bash -c 'node --input-type=module -e "import { getRoleCapacity as g } from \"/workspace/packages/brain/src/orchestrator/fleet-node/node-profile.js\"; const ok=g({baseCapacity:0,role:\"proposer\"}).capacity===0 && g({baseCapacity:0,role:\"generator\"}).capacity===0 && g({baseCapacity:8,role:\"proposer\"}).capacity===4; if(!ok){console.error(\"FAIL invariant/guard\");process.exit(1)} console.log(\"OK layer3 invariant\")"'

- [ ] [BEHAVIOR] [L2] B-03: 层② macOS pressure 内核自评映射表 0→0/1→0.3/2→0.7/3→1
  动作: 调 `macPressureLevelToRatio(0..3)`
  预期观察: 依次返回 0 / 0.3 / 0.7 / 1（精确）
  等待预算: 0s
  留证: node 命令 stdout（OK layer2 mapping）
  Test: manual:bash -c 'node --input-type=module -e "import { macPressureLevelToRatio as m } from \"/workspace/packages/brain/src/platform-utils.js\"; const ok=m(0)===0&&Math.abs(m(1)-0.3)<1e-9&&Math.abs(m(2)-0.7)<1e-9&&m(3)===1; if(!ok){console.error(\"FAIL mapping\");process.exit(1)} console.log(\"OK layer2 mapping\")"'

- [ ] [BEHAVIOR] [L2] B-04: 层② 内核不可用回退 — level=-1/非法 → null（darwin free% 仅此时参与）
  动作: 调 `macPressureLevelToRatio(-1)` 与 `macPressureLevelToRatio(99)`
  预期观察: 均返回 null（触发既有 used_ratio 回退，不抛错）
  等待预算: 0s
  留证: node 命令 stdout（OK layer2 fallback）
  Test: manual:bash -c 'node --input-type=module -e "import { macPressureLevelToRatio as m } from \"/workspace/packages/brain/src/platform-utils.js\"; if(m(-1)!==null||m(99)!==null){console.error(\"FAIL fallback\");process.exit(1)} console.log(\"OK layer2 fallback\")"'

- [ ] [BEHAVIOR] [L2] B-05: 层① 公式守卫 — 真 16GB/10核 stats → physical≥8（不命中下限兜底2）
  动作: 调 `calculatePhysicalCapacity(16384,10,400,0.5)`
  预期观察: 返回 ≥ 8（证公式正确，bug 在采集侧）
  等待预算: 0s
  留证: node 命令 stdout（OK layer1 physical=N）
  Test: manual:bash -c 'node --input-type=module -e "import { calculatePhysicalCapacity as f } from \"/workspace/packages/brain/src/platform-utils.js\"; const p=f(16384,10,400,0.5); if(p<8){console.error(\"FAIL physical=\"+p);process.exit(1)} console.log(\"OK layer1 physical=\"+p)"'

- [ ] [BEHAVIOR] [L3] B-06: 层① 真机接缝 — 部署后 curl capacity-budget，us-mac-m4 physical≥8 且 effective≥4 [接缝]
  动作: 部署后 GET /api/brain/capacity-budget，取 fleet 中 id=us-mac-m4 项
  预期观察: physical_capacity ≥ 8 且 effective_slots ≥ 4（当前 live 为红：physical=2/effective=1）
  等待预算: 10s
  留证: curl 响应 JSON（us-mac-m4 项），非重复执行——只读但受 pressure 水位影响，边界抖动记 findings 不判 FLAKY
  Test: manual:bash -c 'curl -sf -m 10 "${BRAIN_URL:-http://localhost:5221}/api/brain/capacity-budget" | jq -e ".fleet[] | select(.id==\"us-mac-m4\") | select(.physical_capacity>=8 and .effective_slots>=4)" >/dev/null && echo "OK layer1 seam" || { echo "FAIL us-mac-m4 physical/effective below target"; exit 1; }'

## Invariant 覆盖（历史铁律映射）

- [ ] [BEHAVIOR] INV-1 [manual不回退] effective=0（drained/offline）机器不可派语义不被容量保底覆盖 — 由 B-02（baseCapacity=0 → capacity=0）断言
  Test: manual:bash -c 'node --input-type=module -e "import { getRoleCapacity as g } from \"/workspace/packages/brain/src/orchestrator/fleet-node/node-profile.js\"; for (const r of [\"proposer\",\"generator\",\"evaluator\",\"judge\"]){ if(g({baseCapacity:0,role:r}).capacity!==0){console.error(\"FAIL INV-1 \"+r);process.exit(1)} } console.log(\"OK INV-1\")"'
- INV-2 [单slot串行] 单 slot 内串行执行 — N/A：本 sprint 只改容量核算，不触及 slot 执行调度语义。
