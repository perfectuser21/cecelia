---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 修复本机 kernel 容量三层失真（10核16GB 空机被算成 0 个 proposer 槽）

**范围**: packages/brain 容量口径三层修复：①collectLocalStats/computeCapacityFromStats 采集与管道 ②macOS 内核压力等级映射 ③轻角色 effective≥1 保底≥1。无 HTTP 新增、无 DB 写路径。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] platform-utils.js 导出 macOSPressureLevelToFraction（内核压力等级→折算系数）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/platform-utils.js','utf8');if(!c.includes('macOSPressureLevelToFraction'))process.exit(1)"
  期望: exit 0

- [ ] [ARTIFACT] fleet-resource-cache.js 导出 computeCapacityFromStats（stats+macPressureLevel→{physicalCapacity,effectiveSlots,pressure}）并被 collectServerStats 使用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/fleet-resource-cache.js','utf8');if(!c.includes('computeCapacityFromStats'))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，内嵌 manual:bash 单行命令）

- [ ] [BEHAVIOR] [L2] B-01: 根因① 管道——mock 本机级 stats(10核16384MB, Normal) → physical≥8 且 effective≥4
  动作: 调 computeCapacityFromStats({cpu:{cores:10},memory:{totalGB:16,usagePercent:43}}, {macPressureLevel:0})
  预期观察: 返回 physicalCapacity≥8（非当前实测的 2）且 effectiveSlots≥4
  等待预算: 0s
  留证: 命令 stdout（OK step1 physical N effective M）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}/packages/brain"; node --input-type=module -e "import { computeCapacityFromStats as c } from \"./src/fleet-resource-cache.js\"; const r = c({ platform: \"Darwin arm64\", cpu: { cores: 10, usagePercent: 24 }, memory: { totalGB: 16, usedGB: 6, usagePercent: 43 } }, { macPressureLevel: 0 }); if (!(r.physicalCapacity >= 8)) { console.error(\"FAIL physical\", r.physicalCapacity); process.exit(1); } if (!(r.effectiveSlots >= 4)) { console.error(\"FAIL effective\", r.effectiveSlots); process.exit(1); } console.log(\"OK\", r.physicalCapacity, r.effectiveSlots);"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-02: 根因② macOS 内核压力映射表精确相等（0→0/1→0.3/2→0.7/3→1，非 0-3→-1）
  动作: 对 level 0/1/2/3/9 调 macOSPressureLevelToFraction
  预期观察: 0→0、1→0.3、2→0.7、3→1 逐项精确相等，9→-1 sentinel
  等待预算: 0s
  留证: 命令 stdout（OK step2 mapping）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}/packages/brain"; node --input-type=module -e "import { macOSPressureLevelToFraction as f } from \"./src/platform-utils.js\"; const e = {0:0,1:0.3,2:0.7,3:1}; for (const k of [0,1,2,3]) { if (f(k) !== e[k]) { console.error(\"FAIL\", k, f(k)); process.exit(1); } } if (f(9) !== -1) { console.error(\"FAIL sentinel\", f(9)); process.exit(1); } console.log(\"OK mapping\");"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-03: 根因② 接线——darwin 用内核 level 折算（不用 free%），level=-1 回退 used_ratio 不崩溃
  动作: computeCapacityFromStats(同一 stats memory.usagePercent=90) 分别传 macPressureLevel=2 与 -1
  预期观察: level=2 → pressure=0.7（内核值，非 0.9 的 free% 值）；level=-1 → pressure=0.9（回退 used_ratio），均不抛
  等待预算: 0s
  留证: 命令 stdout（OK step3 kernel+fallback）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}/packages/brain"; node --input-type=module -e "import { computeCapacityFromStats as c } from \"./src/fleet-resource-cache.js\"; const s = { platform: \"Darwin arm64\", cpu: { cores: 10, usagePercent: 10 }, memory: { totalGB: 16, usedGB: 14, usagePercent: 90 } }; const u = c(s, { macPressureLevel: 2 }); if (Math.abs(u.pressure - 0.7) > 1e-9) { console.error(\"FAIL kernel\", u.pressure); process.exit(1); } const fb = c(s, { macPressureLevel: -1 }); if (Math.abs(fb.pressure - 0.9) > 1e-9) { console.error(\"FAIL fallback\", fb.pressure); process.exit(1); } console.log(\"OK kernel+fallback\");"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-04: 根因③ 角色保底——proposer(权重2) base=1 → capacity≥1；base=0→0；generator(权重4) base=3→0
  动作: 对 getRoleCapacity 传 (base=1 proposer)、(base=0 proposer)、(base=3 generator)
  预期观察: proposer base1 消灭 floor 死区得≥1；proposer base0 仍 0（drained 不复活）；generator base3 仍 0（重角色门控保留）
  等待预算: 0s
  留证: 命令 stdout（OK step4 role floor guard）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}/packages/brain"; node --input-type=module -e "import { getRoleCapacity as g } from \"./src/orchestrator/fleet-node/node-profile.js\"; if (!(g({ baseCapacity: 1, role: \"proposer\" }).capacity >= 1)) { console.error(\"FAIL proposer deadzone\"); process.exit(1); } if (g({ baseCapacity: 0, role: \"proposer\" }).capacity !== 0) { console.error(\"FAIL drained\"); process.exit(1); } if (g({ baseCapacity: 3, role: \"generator\" }).capacity !== 0) { console.error(\"FAIL heavy gate\"); process.exit(1); } console.log(\"OK role floor guard\");"'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] B-05: 金链路——effective_slots=1 proposer(无 manual) available≥1；effective=0+manual 仍 available=0
  动作: getMachineCapacity 对 fleet(effective_slots=1, us-mac-m4) role=proposer 无 manual；再对 fleet(effective_slots=0) role=proposer + manual_dispatch=true
  预期观察: 前者 available≥1（消灭 run 8783807c 的 all_execution_targets_exhausted 归零）；后者 available=0（manual override 不复活 drained）
  等待预算: 0s
  留证: 命令 stdout（OK step5 available N drained 0）
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}/packages/brain"; node --input-type=module -e "import { createProductionCapabilityProbes as F } from \"./src/orchestrator/preflight/production-probes.js\"; const mk = (fleet) => F({ pool: { query: async () => ({ rows: [] }) }, registry: { get: () => {} }, fetchFn: async () => new Response(JSON.stringify({ fleet }), { status: 200, headers: { \"content-type\": \"application/json\" } }), env: { CECELIA_MACHINE_ID: \"us-mac-m4\" }, nodeAdmissionClient: { getAdmission: async () => ({ state: \"base_admitted\", base_admitted: true, dispatch_ready: true, reasons: [] }) } }); const a = await mk([{ id: \"us-mac-m4\", online: true, effective_slots: 1, physical_capacity: 8, pressure: 0 }]).getMachineCapacity({ machine: \"us-mac-m4\", task_bundle: { role: \"proposer\" } }); if (!(a.available >= 1)) { console.error(\"FAIL eff1\", a.available); process.exit(1); } const b = await mk([{ id: \"us-mac-m4\", online: true, effective_slots: 0, physical_capacity: 0, pressure: 1 }]).getMachineCapacity({ machine: \"us-mac-m4\", task_bundle: { role: \"proposer\", inputs: { manual_dispatch: true } } }); if (b.available !== 0) { console.error(\"FAIL drained\", b.available); process.exit(1); } console.log(\"OK\", a.available, b.available);"'
  期望: exit 0

## Invariant 覆盖（铁律映射）

- [ ] [BEHAVIOR] [L2] INV-1 [口径三源失真]: 容量异常先查口径三源——本单根因②正是「未接线恒空」（getMacOSMemoryPressure 已存在但容量链未用），B-03 断言接线后内核 level 真实参与（level=2→pressure=0.7 而非 free% 0.9）即证死链已接
  Test: manual:bash -c 'cd "${WORKSPACE_PATH:-/workspace}/packages/brain"; node --input-type=module -e "import { computeCapacityFromStats as c } from \"./src/fleet-resource-cache.js\"; const u = c({ platform: \"Darwin arm64\", cpu: { cores: 10, usagePercent: 10 }, memory: { totalGB: 16, usedGB: 14, usagePercent: 90 } }, { macPressureLevel: 2 }); if (Math.abs(u.pressure - 0.7) > 1e-9) { console.error(\"FAIL untied\", u.pressure); process.exit(1); } console.log(\"OK INV-1 wired\");"'
  期望: exit 0
- INV-2 [验证命令实跑确认 exit code]: 本 DoD 全部 Test 为 node --input-type=module -e 显式 process.exit(1)/0，非 vitest include-scope 绿态退 0 —— 覆盖（每条命令实跑真退码）。
- INV-3 [证据前置]: N/A（evaluator 责任；proposer 侧保证 5 条 BEHAVIOR 均机检可复跑、oracle 明确）。
- INV-4 [证据窗口]: N/A（judge 责任）。
- INV-5 [评估时钟 validation clock]: N/A 于合同内容——本合同无 attempt_id/capability_snapshot_id 字面值，validation identity 由 Runner 运行时注入，无固化（搜索 UUID 字面值为空）。
