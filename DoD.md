contract_branch: cp-harness-propose-r1-a478def7-r32873c79-a18
sprint_dir: sprints/08292318-kernel-a478def7

---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 合同重开后主链派全新 generator，根除 WORKSPACE_RESOLUTION_FAILED 必死（r73）

**范围**: `packages/brain/src/orchestrator/derive.js` 中 `deriveTask` 3a `no_pr` 分支的合同重开纪元路由判定（纯函数）；对应 RED→GREEN 测试 + 版本 bump 四处同步。
**大小**: S

## ARTIFACT 条目

- [ ] [ARTIFACT] derive.js no_pr 分支含合同重开纪元识别 + 全新 generator 路由
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/orchestrator/derive.js','utf8');if(!c.includes('contract_reopened_fresh_generator'))process.exit(1)"

- [ ] [ARTIFACT] 冻结合同测试文件存在且真 import derive.js（禁 mock 被改的边）
  Test: node -e "const c=require('fs').readFileSync('sprints/08292318-kernel-a478def7/tests/derive-reopen-fresh-generator.test.js','utf8');if(!c.includes(\"orchestrator/derive.js\")||c.includes('vi.mock'))process.exit(1)"

- [ ] [ARTIFACT] 版本 bump 四处同步（package.json / package-lock.json / .brain-versions / DEFINITION.md）
  Test: bash -c 'bash scripts/check-version-sync.sh'

## BEHAVIOR 条目（内嵌可执行 manual: 命令 — autonomous 纯函数真 import derive.js）

- [ ] [BEHAVIOR] [L2] B-01: 合同重开纪元内 no_pr（纪元后未派全新 generator）→ 派全新 generator
  动作: 喂复刻 r73 的 observed 快照（decisionLog 含 reopen_gan_contract 行 + 纪元后无 spawn:generator），调 derive
  预期观察: 返回 action=spawn:generator、reason=contract_reopened_fresh_generator（不含 generator-fix）
  等待预算: 0s
  留证: route-oracle.mjs stdout（OK: scenario=reopen → {...}）
  Test: manual:bash -c 'node sprints/08292318-kernel-a478def7/route-oracle.mjs reopen'

- [ ] [BEHAVIOR] [L2] B-02: 有界——重开后已派过全新 generator，再 no_pr → 回落既有 fix 语义
  动作: 喂 decisionLog（reopen 后 hop15 已 spawn:generator）的 observed 快照，调 derive
  预期观察: 返回 action=spawn:generator-fix、reason=no_pr（不无限重发全新 generator）
  等待预算: 0s
  留证: route-oracle.mjs stdout（OK: scenario=bounded → {...}）
  Test: manual:bash -c 'node sprints/08292318-kernel-a478def7/route-oracle.mjs bounded'

- [ ] [BEHAVIOR] [L2] B-03: 负向——无 reopen 历史的 no_pr → 语义不变仍 fix 路由
  动作: 喂无 reopen_gan_contract 行的 no_pr observed 快照，调 derive
  预期观察: 返回 action=spawn:generator-fix、reason=no_pr（与现行逐字节一致）
  等待预算: 0s
  留证: route-oracle.mjs stdout（OK: scenario=negative → {...}）
  Test: manual:bash -c 'node sprints/08292318-kernel-a478def7/route-oracle.mjs negative'

- [ ] [BEHAVIOR] [L2] B-04: 纪元隔离——重开前的 spawn:generator 不算「已派」→ 仍派全新 generator
  动作: 喂 decisionLog（仅重开前 hop10 有 spawn:generator）的 observed 快照，调 derive
  预期观察: 返回 action=spawn:generator、reason=contract_reopened_fresh_generator（重开前产出不影响判定）
  等待预算: 0s
  留证: route-oracle.mjs stdout（OK: scenario=epoch → {...}）
  Test: manual:bash -c 'node sprints/08292318-kernel-a478def7/route-oracle.mjs epoch'

- [ ] [BEHAVIOR] [L2] INV-1 generator-infra-retry-identity：无重开纪元时 no_pr 仍 generator-fix（infra-retry 身份不被本改动改写）
  动作: 复用负向快照（无 reopen 行）调 derive，确认 generator-fix 身份保持
  预期观察: action=spawn:generator-fix（本改动与 infra-retry 身份正交，未改 generator-fix 重派身份）
  等待预算: 0s
  留证: route-oracle.mjs stdout（OK: scenario=negative → spawn:generator-fix）
  Test: manual:bash -c 'node sprints/08292318-kernel-a478def7/route-oracle.mjs negative'

## Invariant 覆盖（铁律逐条映射）

> INV-1（generator-infra-retry-identity）由上方 BEHAVIOR INV-1 可执行守卫覆盖；以下三条本 sprint 不触及，显式 N/A：

- INV-2 fleet-brain-url：N/A — 纯函数路由，不注入/读取 HARNESS_BRAIN_URL/BRAIN_URL（本 sprint 不触及 dispatcher/worker 注入路径）。
- INV-3 planner-role-branch：N/A — 不涉及 planner workspace / 分支 checkout（derive 只读内存快照）。
- INV-4 kernel-validation-clock：N/A — 不触碰 validation_clock_required（no_pr 分支在 validation clock 门之外，纯路由分流）。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A）
