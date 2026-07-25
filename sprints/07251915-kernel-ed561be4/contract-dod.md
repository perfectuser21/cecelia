---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel capability gate：派发前能力预检

**范围**: 新增 server-owned capability snapshot 与 attempt 前 preflight 门；阻断 provider/GitHub/PostgreSQL/测试依赖/外部模型 capability 缺失；分流 product failure 与 infrastructure/capability mismatch；保持 contract 继承与 telemetry schema 不变；同步版本账本。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 合同草案含 Golden Path、八要素、接缝/禁 mock 清单与 E2E 验收
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07251915-kernel-ed561be4/contract-draft.md','utf8');for(const x of ['## Golden Path','## 八要素需求规范','## 禁 mock 边清单','## E2E 验收'])if(!c.includes(x))throw new Error('missing '+x)"

- [ ] [ARTIFACT] Test Contract 四列表头与相对测试路径稳定
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('sprints/07251915-kernel-ed561be4/contract-draft.md','utf8');if(!c.includes('| 功能 | Test File | BEHAVIOR 覆盖 | 预期红证据 |'))throw new Error('missing test contract header');if(!c.includes('`tests/capability-gate.contract.test.ts`'))throw new Error('missing relative test path')"

- [ ] [ARTIFACT] Brain 源码变更必须同步版本账本
  Test: bash scripts/devgate/check-version-sync.sh

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] attempt 前阻断 provider_auth 缺失并返回 infrastructure_blocked
  动作: 执行 capability gate 合同测试中的 provider auth 缺失用例，使用注入依赖返回结构化 auth 失败。
  预期观察: `attemptStore.createAttempt` 不被调用，failure_class 为 `infrastructure_blocked`，缺口证据来自结构化 probe。
  验证命令: Test: manual:bash -c 'bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t \"createAttempt 前阻断\""'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] server-owned capability snapshot 覆盖 provider/GitHub/PostgreSQL/model 且复用既有账本
  动作: 执行 snapshot 用例，给 dispatcher/loop 注入冻结合同要求与 provider assignment。
  预期观察: snapshot 至少包含 provider_auth、github、postgresql_test_dependency、external_model 四类能力；写入既有 JSON/账本字段，不新增 telemetry schema。
  验证命令: Test: manual:bash -c 'bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t \"server-owned capability snapshot\""'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] capability mismatch 路由人审和告警，不进入 generator-fix
  动作: 运行 capability mismatch 用例，模拟合同要求真实 PG/模型能力但执行环境缺失。
  预期观察: derive/loop 给出人审或等价阻断动作，并触发结构化告警；`spawn:generator-fix` 不出现。
  验证命令: Test: manual:bash -c 'bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t \"capability mismatch 路由人审和告警\""'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] product failure 保持 generator-fix 路由
  动作: 运行 product failure 用例，给 observed 注入满足 snapshot 的产品断言失败。
  预期观察: route 仍为 `spawn:generator-fix`；不会误打 `infrastructure_blocked` 或 capability mismatch。
  验证命令: Test: manual:bash -c 'bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t \"product failure 保持 generator-fix 路由\""'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 同签名网络瞬断重试受收敛闸约束
  动作: 运行 transient/network 用例，连续喂入相同 capability signature 的瞬断失败。
  预期观察: 首次失败允许有限重试；达到阈值后阻断或转人审；不会无限创建 attempt。
  验证命令: Test: manual:bash -c 'bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t \"同签名网络瞬断重试受收敛闸约束\""'
  期望: exit 0

- [ ] [BEHAVIOR] [L2] 不修改 contract 继承和 telemetry schema
  动作: 运行保护性回归，用文件/模块快照断言 contract-store、migration/telemetry 相关入口未被新增 schema 改写。
  预期观察: 合同继承仍走既有 `initiative_contracts` / `contract-store` 语义；本单无 telemetry schema 变更。
  验证命令: Test: manual:bash -c 'bash -lc "cd /workspace && npx vitest run sprints/07251915-kernel-ed561be4/tests/capability-gate.contract.test.ts -t \"不修改 contract 继承和 telemetry schema\""'
  期望: exit 0

## Invariant 铁律逐条映射

- INV-01 失败恢复：N/A，本单不改 watchdog/orphan requeue。
- INV-02 语义成功：BEH-01/02/03/04 以 failure_class、route、attempt 创建与 snapshot 字段作语义断言，不只看 ok。
- INV-03 依赖修复：N/A，本单不处理 advisory。
- INV-04 长等心跳：N/A，本单不改 relay/heartbeat。
- INV-05 毕业校验：ARTIFACT-03 强制版本同步；Generator 后续仍受 devgate 约束。
- INV-06 手工证据：每条 BEHAVIOR 都要求真实 exit code；不接受自然语言“已登录/已缺失”自证。
- INV-07 命令真跑：所有 manual 命令真跑 `npx vitest` / `bash`，非文本自证。
- INV-08 烟测铁律：N/A，本单不新增 smoke 脚本。
- INV-09 烟测铁律（重复来源）：同 INV-08。
- INV-10 多轮扫描：BEH-05 覆盖同签名多次重复失败与收敛闸。
- INV-11 重扫幂等：BEH-05 断言同签名重试有上限，不无限创建 attempt。
- INV-12 时间关系：N/A，本单不引入跨模块时间常数。
- INV-13 剧场匹配：target_environment 维持 local_api，不受自然语言平台词影响。
- INV-14 环境来源：task-plan / frontmatter / PRD 均锚定 local_api。
- INV-15 Judge格式：N/A，本单不改 judge result schema。
- INV-16 字段长度：N/A，本单复用既有 JSON/文本字段，不新增有限长列。
- INV-17 退役追溯：N/A，本单不是退役功能复活。
- INV-18 失败分支：BEH-01/03/05 明确覆盖 auth/capability/transient 失败分支。
- INV-19 烟测铁律（重复来源）：同 INV-08。
- INV-20 停滞探针：N/A，本单不改 report/feature patrol。
- INV-21 产物核验：BEH-01/02/03/04/05/06 均验证真实 route/attempt/snapshot 行为，不只看文件存在。
- INV-22 有头核对：N/A，本单不涉及 headed。
- INV-23 派发锚点：N/A，本单不改 base_repo/pr_url 锚点。
- INV-24 退役实证：N/A。
- INV-25 后台告警：BEH-03 要求 capability mismatch 触发结构化告警。
- INV-26 表名认领：N/A，本单优先复用既有账本，不新建共享表。
- INV-27 消费闭环：snapshot 的真实消费方是 dispatcher/derive/loop 路由；BEH-02/03/04 证明闭环。
- INV-28 多端完整：provider auth/GitHub/PG/model 四类能力均入 snapshot。
- INV-29 语义一致：同一 failure_class 在 preflight 与 derive 端必须一致，不得分叉。
- INV-30 引用核验：N/A，本单不改 git ref 逻辑。
- INV-31 测试隔离：BEH-01 至 BEH-06 仅用注入依赖，不打真实外部服务。
- INV-32 部署失败：N/A，本单不改部署链。
- INV-33 生产真相：能力状态来自结构化 probe，不来自 workspace diff 或 agent 口述。
- INV-34 测试质量：合同测试用生产模块与注入依赖，不用纯源码 grep 冒充行为。
- INV-35 合同表格：ARTIFACT-02 固定四列表头。
- INV-36 红灯提交：Generator 必须精确 add 测试路径；本合同不授权 `git add .`。
- INV-37 接线回归：BEH-01/02/03/04 使用真实 dispatcher/derive 接线，不 mock 被改边。
- INV-38 定时入口：N/A，本单不新增 cron/JOBS。
- INV-39 合并权限：PR 保持 OPEN，Generator 不得自动 merge。
- INV-40 环境透传：N/A，本单不改 headed relay env。
- INV-41 历史合同：本合同已读取 dispatcher/derive/provider-registry/pre-flight 现有回归，不复用旧路径假设。
- INV-42 共享禁区：N/A，本单不授权共享 CI 基础设施文件变更。
- INV-43 提前合并：PR 必须等待独立复审；不得 evaluator/judge 前自动 merge。
- INV-44 烟测铁律（重复来源）：同 INV-08。
- INV-45 源码烟测：N/A，本单不新增 smoke allowlist。
- INV-46 类型接线：N/A，本单不新增 task_type。
- INV-47 服务存活：N/A，本单不改宿主服务存活判定。
- INV-48 宿主服务：N/A，本单不新增常驻服务。
- INV-49 巡检清单：N/A，本单不新增宿主服务。
- INV-50 烟测铁律（重复来源）：同 INV-08。
- INV-51 单槽串行：task-plan 仅 `ws1`，单实现者。
- INV-52 环境假设：能力缺失必须来自 probe 结果，不写死“某 provider 一定可用”。
- INV-53 真境完成：真实外部能力 smoke 仅列入未覆盖清单；自动验收只做到注入依赖层。
- INV-54 多租户测：N/A，本单不涉及租户数据。
- INV-55 凭据安全：测试不得把 secrets 写入日志；probe 结果只保留结构化状态。
- INV-56 日志脱敏：snapshot/alert 不记录凭据或自然语言 transcript。
- INV-57 端点鉴权：N/A，本单不新增 API endpoint。
- INV-58 租户隔离：N/A，本单不触及租户读写。

## 生产接缝（不由 worker 自动执行）

- [ ] [L3-PENDING] 真环境 smoke：上线后用真实 provider account/GitHub/PG/model 凭据跑一次 capability preflight，确认 snapshot 与缺口分类正确。
- [ ] [L3-PENDING] 真实告警链核验：能力不匹配触发的人审/告警在实际通知渠道中可见。
