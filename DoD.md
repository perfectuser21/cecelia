contract_branch: cp-harness-propose-r1-78e74563-r9e369fbc-a4
sprint_dir: sprints/08131731-kernel-78e74563

---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: 本机容量三层失真修复（10核16GB空机不再被算成 0 个 proposer 槽）

**范围**: `packages/brain/src/routes/infra-status.js`(collectLocalStats 主机资源采集) + `packages/brain/src/platform-utils.js`(resolveMemPressureRatio 内核 pressure 映射) + `packages/brain/src/fleet-resource-cache.js`(接入内核 pressure) + `packages/brain/src/orchestrator/fleet-node/node-profile.js`(getRoleCapacity effective≥1 保底) + 回归测试
**大小**: M

## ARTIFACT 条目

- [x] [ARTIFACT] 永久回归测试文件落在 brain CI 覆盖路径（VP3 永久保留要求）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/fleet-local-capacity-fix.test.js','utf8');if(!c.includes('本机容量三层失真修复'))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] platform-utils.js 导出内核 pressure 映射纯函数 resolveMemPressureRatio
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/platform-utils.js','utf8');if(!/export function resolveMemPressureRatio|export const resolveMemPressureRatio/.test(c))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] 回归测试无 vi.mock/stub 被改的边（禁 mock 边清单执法：CONTRACT IS LAW）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/__tests__/fleet-local-capacity-fix.test.js','utf8');if(/vi\.mock|sinon\.stub|\.stub\(/.test(c))process.exit(1)"
  期望: exit 0

- [x] [ARTIFACT] 可观测留痕（NFR）：fleet 采集链在 online 机器 effective 归零 / physical 触发下限兜底时 warn 留痕，不静默无限退避
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/fleet-resource-cache.js','utf8');if(!/warn|WARN|告警|留痕|bottom|兜底|effective.*0|归零/i.test(c))process.exit(1)"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，内嵌 manual:bash 单行命令）

- [x] [BEHAVIOR] [L2] B-01: 根因① 本机采集真实主机资源，physical 不再触底兜底 2
  动作: 运行回归单测 describe「① collectLocalStats 主机资源采集」（注入主机级 10核/16384MB）
  预期观察: collectLocalStats 返回 cpu.cores=10、memory.totalGB≈16；据此 calculatePhysicalCapacity ≥ 8（不再是 2）
  等待预算: 0s
  留证: vitest 输出末 5 行（含 3 passed）
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/__tests__/fleet-local-capacity-fix.test.js -t "① collectLocalStats"'
  期望: exit 0

- [x] [BEHAVIOR] [L2] B-02: 根因② macOS 内核 pressure 等级映射，darwin free% 路径不再参与
  动作: 运行回归单测 describe「② macOS 内核 pressure 映射」（映射表 + free% 不参与 + -1 fallback + 非 darwin 不变）
  预期观察: darwin kernelLevel 0/1/2/3 → 0/0.3/0.7/1；darwin level=0 且 usage=90 → 0（free% 不参与）；darwin level=-1 → 0.9（明确 fallback 非静默 0）；linux usage=50 → 0.5
  等待预算: 0s
  留证: vitest 输出末 5 行（含 7 passed）
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/__tests__/fleet-local-capacity-fix.test.js -t "② macOS 内核 pressure"'
  期望: exit 0

- [x] [BEHAVIOR] [L2] B-03: 根因③ effective≥1 角色分配保底，消灭 floor 归零死区且 drained/offline 仍不可派
  动作: 运行回归单测 describe「③ 角色分配保底消灭 floor 归零死区」
  预期观察: effective=1 proposer(权重2) capacity≥1、effective=2 generator(权重4) capacity≥1（死区消灭）；base=0 两角色 capacity=0（不可派语义保留，manual override 不回退）；commander/大 base 分配不受破坏
  等待预算: 0s
  留证: vitest 输出末 5 行（含 6 passed）
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/__tests__/fleet-local-capacity-fix.test.js -t "③ 角色分配保底"'
  期望: exit 0

- [x] [BEHAVIOR] [L2] B-04: 出口真验（接缝）——部署后 us-mac-m4 容量回正，proposer 真实可派 [接缝×2]
  动作: 修复 merge+deploy 到本机 Brain 后，curl /api/brain/capacity-budget 读回 us-mac-m4 容量
  预期观察: us-mac-m4 online=true 且 physical_capacity≥8 且 effective_slots≥4（当前空载水位）；部署前此断言 FAIL 属预期（logic-done-pending）
  等待预算: 15s
  留证: capacity-budget 响应中 us-mac-m4 fleet 条目 JSON
  Test: manual:bash -c 'curl -sf -m 10 localhost:5221/api/brain/capacity-budget | jq -e --arg id us-mac-m4 "any(.fleet[]; .id==\$id and .online==true and .physical_capacity>=8 and .effective_slots>=4)"'
  期望: exit 0（部署后）

- [x] [BEHAVIOR] INV-1 [口径三源失真] 修复后本机口径反映主机真实资源，不再产生假容量退化
  动作: 运行 B-01（本机采集真实化）——INV-1 由「容器口径冒充主机口径」失真的消除来保证
  预期观察: 注入主机级资源后 physical≥8，证明本机容量口径不再被容器 cgroup 口径污染（口径三源失真中的「口径错采」被修）
  等待预算: 0s
  留证: 复用 B-01 vitest 输出
  Test: manual:bash -c 'cd /workspace/packages/brain && npx vitest run src/__tests__/fleet-local-capacity-fix.test.js -t "推导 physical"'
  期望: exit 0
