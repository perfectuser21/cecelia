# Sprint PRD — Kernel target-aware required-context gate 恢复

## OKR 对齐

- **对应 KR**：KR-2（Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环）
- **当前进度**：82%
- **本次推进预期**：84%

## 背景

上一轮恢复在 Preview CI 合同里仍存在 authority 漂移、负例互相遮挡、preview 失败证据不落地、post-merge 闸门可被合并测试替代的问题。2026-07-27 本次恢复要把 required contexts、repo/run/task 身份、current head SHA、preview/staging/production 闸门全部收回到服务端真相，并让每个阻断理由都能在独立红证据里稳定触发。

## Golden Path（核心场景）

系统从收到 Kernel Harness 合同校验任务 → 用服务端 task/run/PR 真相推导 target_environment、base_repo、required contexts 与 current head SHA → 到达“只有同一最终 SHA 上 evaluator PASS、judge PASS、人工批准齐全且上下文全部通过时才允许继续”的出口。

具体：
1. 系统读取服务端 task、run、PR 事实，确定 base_repo、run/task 身份、当前 PR head SHA、target_environment 与 required context 集；调用方传入的 expected_repo、expected_run、role 只能作参考，不能建立 authority。
2. 系统把每个 accepted check 绑定到 exact current head SHA，并分别验证 stale SHA、wrong repo、wrong run/task、missing required context、preview-required failure、local required-context failure、missing context mapping、external infrastructure failure 等独立负例，任何一项命中都返回稳定阻断原因。
3. 当 target_environment=local_api 且当前 SHA 上所有本地 required contexts 通过时，preview 可记为 neutral/skipped；只要本地 required context 有失败就必须阻断。依赖 preview 的 target 一旦 preview 缺失或失败必须硬失败；服务端 context mapping 缺失或未知时 fail-closed。
4. 真实 `.github/workflows/preview-deploy.yml` 调用 `/api/brain/preview/start` 后，系统保留兼容响应并落 evidence：`http_status`、`response_body`、`error` 三字段在失败路径必须全部非空；成功路径单独验证，不得用 `|| true`、空响应或成功状态伪装失败验收。
5. generator-fix 只可通过 exact SHA 上的真实 ground-truth → derive/gate → orchestrator decision-log 迁移闭环证明修复；post-merge 的 staging missing、staging SKIP/no-contract、staging FAIL、stale/missing tested_sha、production missing、production FAIL、final report missing 必须各自独立硬阻断；PR 保持 Draft，`autoMergeRequest=null`，且 evaluator PASS、judge PASS、human approval 必须都是同一最终 SHA 的服务端记录，新提交会使旧批准失效。

## 边界情况

- 同一组负例必须逐个单测，禁止通过 alternation 或共享成功退出让多项 blocker 假绿。
- 红证据失败必须因为缺少目标行为，而不是 vitest 配置、依赖缺失或外部夹具污染。
- 合同校验只允许隔离/只读夹具，不写入真实 approval，不触碰生产数据库。
- legacy rollout 必须显式开关与回归覆盖，但不能放松新的 target-aware 语义。

## 范围限定

**在范围内**：server-owned required-context 推导、current head SHA 绑定、preview evidence seam、generator-fix ground-truth 闭环、post-merge 独立硬闸、Draft PR 审批记录一致性、legacy rollout 显式回归。
**不在范围内**：生产部署执行、真实人工批准写入、非本任务相关的 workflow 重构、production DB mutation、UI 改版。

## 假设

- [ASSUMPTION: base_repo 为 cecelia monorepo，因此环境推断采用 Cecelia 路由规则；同时 payload 已显式给出 `target_environment=local_api`。]
- [ASSUMPTION: 当前 Journey 无已完成 line FR 可继承，因此累积 FR 使用空占位。]
- [ASSUMPTION: 本 sprint 属于 fix/recovery，但会改变 gate 行为与验收语义，因此后续仍需人工复审。]

## 预期受影响文件

- `packages/brain/src/orchestrator/`: required-context 派生、gate 判定、decision-log 与 SHA 绑定。
- `packages/brain/src/routes/preview.js`: `/api/brain/preview/start` 失败证据持久化与兼容响应。
- `.github/workflows/preview-deploy.yml`: 真实 preview curl → Brain API seam 的合同锚点与回归入口。
- `packages/brain/src/orchestrator/__tests__/`、`packages/brain/src/__tests__/`、`tests/regression/`: 独立负例、post-merge 闸门、preview 失败证据、approval invalidation 回归。
- `DEFINITION.md`、`VERSION`、`.brain-versions`: 若修改 `packages/brain/src/`，需同步 Brain 版本账本。

## NFR 约束

<!-- 来源: decisions 表 category=nfr，PrepPRD 显式值优先 -->
- 超时/延迟: preview curl 与 gate 查询必须保留有界超时，失败返回稳定 reason，不因等待超时而吞掉真实错误。
- 频控: 每个 blocker 必须独立断言，禁止把多个失败原因折叠成一个“任一即绿”的组合门。
- 版本要求: 保持现有 preview route 响应兼容，同时新增 `http_status`、`response_body`、`error` 证据字段。
- 可观测: accepted check、decision log、post-merge gate 全部锚定 exact current head SHA；preview 失败证据三字段必须可查询。
- 安全/数据: 合同验证使用隔离或只读夹具，禁止写真实 approval，禁止 production DB mutation。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重 -->
- [target_environment来源DB] target_environment 字段由 Brain orchestrator 从 DB tasks.payload 读取，不从本地文件读取；任务注册时必须正确设置（来源: area）
- [SHA锚定] PR 被 CI 兜底机制提前推进时，必须用 PR head SHA 核对 evaluator/judge/approval 证据锚定的 sha 与最终 sha 一致（来源: area）
- [禁止写死环境] 屏幕外坐标、假设调用方参数、假设环境变量等环境假设值禁止写死；要么从服务端真相推导，要么 fail-closed（来源: area）
- [真环境验证] 依赖真实调用方的接缝断言必须在真实目标上验证过才算 done；未真验不能冒充完成（来源: area）
- [失败禁降级] 部署链与 gate 失败路径禁止 warning 降级；必须显式失败并保留错误证据（来源: area）
- [语义成功判定] 通知/写库/证据接口的成功判定必须看语义字段，不能只看通用 ok 或进程退出码（来源: area）
- [共享CI禁区] 共享 CI 基础设施文件未经合同显式授权不可随意修改；若触碰需在合同中明确其验收职责（来源: area）
- [错误码契约] 调用返回 null/false 表示失败的函数时必须显式处理失败分支，不能依赖外层 try/catch 假定异常会抛出（来源: area）
- [manual真跑] manual:node -e 或 shell 断言必须真跑，不得只做静态检查或 bash -n（来源: area）
- [多租户默认] 测试默认至少种两租户并断言隔离，避免 context/approval 串租户（来源: area）
- [租户隔离] 涉及租户数据的查询/写入必须 scope 到当前租户，跨租户数据绝不混读/混写（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私/PII/聊天内容不得明文进日志（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块可留空（只写占位 + 期望验收点的自然语言描述）。最终可执行的 E2E 脚本由 proposer 在 GAN 阶段按 `target_environment=local_api` 产出。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（curl localhost:5221 + vitest + 只读夹具）
# 期望验收点：服务端 task/run/PR 真相决定 target_environment、base_repo、run/task 身份、required contexts 与 current head SHA，调用方参数不能创建 authority。
# 期望验收点：stale check SHA、wrong repo、wrong run/task、missing required context、preview-required failure、local required-context failure、missing context mapping、external infrastructure failure 各自独立失败并返回稳定原因。
# 期望验收点：local_api 仅在当前 SHA 上全部本地 required contexts 通过时才允许 preview neutral/skipped；preview 依赖型 target 在 preview missing/fail 时硬失败。
# 期望验收点：真实 .github/workflows/preview-deploy.yml → /api/brain/preview/start 失败路径会留下非空 http_status、response_body、error；成功路径独立验证，不接受 || true、空响应或 success status 伪装。
# 期望验收点：generator-fix 通过 exact SHA 上的 ground-truth → derive/gate → orchestrator decision-log 迁移闭环证明；post-merge 各 gate 与 Draft PR approval invalidation 独立硬阻断。
```

## journey_type: autonomous
## journey_type_reason: 需求只涉及 Kernel/Brain 后端 gate、workflow 接缝与回归测试，不含 Dashboard 或远端代理交互。
## target_environment: local_api
## target_environment_reason: payload 已显式给出 local_api，验收对象为本地 Brain API、preview route、vitest 与只读夹具，不依赖浏览器或远端 runner。
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: 0cdadc1a-e3a0-46a1-8333-ebbc102883f7
