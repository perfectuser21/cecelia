---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Unified Work Router

## ARTIFACT 条目

- [ ] [ARTIFACT] Work Router、事务 store、receipt API、migration 411、Map preflight、动作闸和 scratch smoke 按冻结设计落位
  Test: node -e "for(const p of ['packages/brain/src/work-router.js','packages/brain/src/work-routing-store.js','packages/brain/src/routes/work-routing.js','packages/brain/migrations/411_work_routing_receipts.sql','packages/brain/scripts/smoke/unified-work-router-smoke.sh'])require('fs').accessSync(p)"

- [ ] [ARTIFACT] Brain 版本与 DEFINITION 同步，且实现无调试日志、死代码或未使用 import
  Test: node scripts/facts-check.mjs

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B-01: credential origin 归一化、日志脱敏与活跃 Kernel workspace 保护 [接缝×2]
  动作: 在真实临时 Git remote/worktree 中配置含 percent-encoded userinfo 的 origin，登记 active Kernel run 后执行两次 workspace reconcile
  预期观察: 等价 origin 不被判 orphan，日志不含 userinfo，active detached cwd 保留，非活跃孤儿仍可清理
  等待预算: 20s
  留证: 两次命令 stdout/stderr 脱敏扫描与 worktree list
  Test: manual:bash -c 'npx vitest run sprints/08121555-unified-work-router/tests/unified-work-router-contract.test.ts -t "凭据 origin 归一化、日志脱敏且保护活跃 Kernel 工作区"'

- [ ] [BEHAVIOR] [L2] B-02: coding mutation 原子创建不可变 receipt 且四档正向映射
  动作: 对空测试库提交四个 change_kind、unknown coding、歧义 repo 与重复 source 请求
  预期观察: 四档只产生批准 profile；coding 均为 harness_initiative；unknown 按 write；歧义阻塞；receipt append-only 且事务/幂等成立
  等待预算: 30s
  留证: Vitest 输出与 work_routing_receipts 查询结果
  Test: manual:bash -c 'npx vitest run sprints/08121555-unified-work-router/tests/unified-work-router-contract.test.ts -t "原子创建 receipt 并只按四档正向映射"'

- [ ] [BEHAVIOR] [L2] B-03: fresh Map 建立 required Impact Contract，异常 fail closed [接缝×2]
  动作: 对真实临时 repo 依次提供 fresh、missing、stale、revision mismatch、scanner invalid 与跨 repo Map
  预期观察: 仅 fresh 同 repo 基线进入 Structure Gate；其余不创建 Provider；合法 map_recovery 单次消费且修复后全量重扫 fresh
  等待预算: 60s
  留证: preflight reason_code、Provider attempt 计数、Impact Contract 与 scanner revision 查询
  Test: manual:bash -c 'npx vitest run sprints/08121555-unified-work-router/tests/unified-work-router-contract.test.ts -t "fresh Map 建立 Impact Contract 且异常 fail closed"'

- [ ] [BEHAVIOR] [L2] B-04: 有头无头动作闸与 Generator trust boundary [接缝×2]
  动作: 真实 worktree 对合法/缺失/过期/superseded/mismatch receipt 执行读写工具，并启动 Generator 容器命令链
  预期观察: 无效写动作前 exit 2 或 Dispatcher 拒绝 executor；只读通过；Generator push 失败且 callback/lease 凭据不可见
  等待预算: 90s
  留证: hook exit code、route_violation、容器 uid/capability/env/push 输出
  Test: manual:bash -c 'npx vitest run sprints/08121555-unified-work-router/tests/unified-work-router-contract.test.ts -t "有头无头动作闸与 Generator trust boundary"'

- [ ] [BEHAVIOR] [L2] B-05: scratch 三入口与三类对照真实验收 [接缝×2]
  动作: 在 attempt-scoped DB 从 API、Intent、Capture 建 coding，并建 content、research、read-only review 对照，随后制造 stale Map、refresh 并 resume
  预期观察: coding 3/3 有 receipt/Harness/正确 Map/active Impact；对照不误路由；stale 不进 Provider且恢复保留审计
  等待预算: 180s
  留证: smoke stdout 与 5 分钟时间窗 DB 查询结果
  Test: manual:bash -c 'bash packages/brain/scripts/smoke/unified-work-router-smoke.sh'

- [ ] [BEHAVIOR] [L2] INV-01: required DevGate 与版本事实保持一致
  动作: 对候选最终提交依次执行三项 Brain DevGate
  预期观察: facts、版本同步与 DoD 映射全部 exit 0
  等待预算: 60s
  留证: 三命令完整 stdout 和 exit code
  Test: manual:bash -c 'node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs'

- [ ] [BEHAVIOR] [L2] INV-02: 凭据与日志安全不回退
  动作: 运行 recovery regression 并扫描其捕获日志中的 URL userinfo 与 callback/lease token 名值
  预期观察: 测试真实走 credential origin，输出只含脱敏 URL，敏感值命中数为 0
  等待预算: 30s
  留证: Vitest 日志脱敏扫描输出
  Test: manual:bash -c 'npx vitest run sprints/08121555-unified-work-router/tests/unified-work-router-contract.test.ts -t "凭据 origin 归一化、日志脱敏且保护活跃 Kernel 工作区"'

## 铁律显式 N/A

- 租户隔离/双租户：路由 receipt 不承载租户业务数据；真实 DB 测试仍创建至少两个 source 并断言不串。
- 端点鉴权：receipt validation API 必须沿用受认证 Brain API；未认证请求是 B-04 的无效路径。
- 真机/RPA、视频、发布：本 Sprint 不涉及，N/A。
- 周期扫描付费第三方 API、后台 job consumer、OS 多端 UI：本 Sprint 不涉及，N/A。

## 失败判定

任一 BEHAVIOR 非零、任一接缝两次结果不一致、出现新增 `legacy_exempt`、Provider 在无 active Impact Contract 时启动、或日志泄露凭据，均为 Sprint FAIL。
