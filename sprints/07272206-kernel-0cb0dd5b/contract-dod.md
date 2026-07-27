---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Sprint: read-only reviewer 结果通道与反馈血缘

**范围**: Kernel attempt result channel、callback authority、feedback lineage、人工 release gate、真实 PostgreSQL/RCI 回归。  
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] result channel 与 feedback lineage 生产实现存在
  Test: node -e "const fs=require('fs');for(const f of ['packages/brain/src/orchestrator/result-channel.js','packages/brain/src/orchestrator/feedback-lineage.js']){const c=fs.readFileSync(f,'utf8');if(!c.includes('export'))process.exit(1)}"

- [ ] [ARTIFACT] callback、dispatcher、ground-truth、execution contract、attempt store 完成接线
  Test: node -e "const fs=require('fs');for(const f of ['packages/brain/src/routes/harness-callback.js','packages/brain/src/orchestrator/dispatcher.js','packages/brain/src/orchestrator/ground-truth.js','packages/brain/src/orchestrator/execution-contract.js','packages/brain/src/orchestrator/attempt-store.js']){const c=fs.readFileSync(f,'utf8');if(!/feedback|result.channel|prior_review|resolution_map/i.test(c))process.exit(1)}"

- [ ] [ARTIFACT] local/remote transport 注入固定 `BRAIN_RESULT_FILE` 且 read-only workspace 不变
  Test: node -e "const fs=require('fs');const files=['packages/brain/src/orchestrator/dispatcher.js','packages/brain/src/orchestrator/remote-bridge-transport.js','packages/brain/src/docker-executor.js'];const c=files.map(f=>fs.readFileSync(f,'utf8')).join('\n');if(!c.includes('BRAIN_RESULT_FILE')||!c.includes('readOnlyWorktree'))process.exit(1)"

- [ ] [ARTIFACT] Brain DEFINITION/package version、migration 与 RCI 同步
  Test: node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('packages/brain/package.json'));if(p.version==='1.267.94')process.exit(1);const d=fs.readFileSync('packages/brain/DEFINITION.md','utf8');if(!/result channel|feedback lineage|结果通道|反馈血缘/i.test(d))process.exit(1);const r=fs.readFileSync('scripts/devgate/kernel-result-feedback-lineage-rci.sh','utf8');if(!r.includes('ROUND2_LINEAGE_PASS'))process.exit(1)"

- [ ] [ARTIFACT] 首次 P0 Controller contract 变更声明 `review_required=true`
  Test: node -e "const fs=require('fs');const c=fs.readFileSync('packages/brain/src/orchestrator/feedback-lineage.js','utf8');if(!c.includes('review_required'))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] read-only attempt 只能写自身固定结果通道（Golden Path Step 1）
  动作: RCI 启动真实只读 worktree 容器并为两个 attempt 分别挂载结果目录。
  预期观察: 固定结果文件可写；workspace、逃逸路径、软链接和另一个 attempt 的文件不可写/读。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario result-channel

- [ ] [BEHAVIOR] [L2] callback 持久化完整 reviewer 结果（Golden Path Step 2）
  动作: 用服务端 attempt token/lease 对真实 callback route 提交固定通道读取的 reviewer result。
  预期观察: HTTP 200；within 60s 在真实 PostgreSQL 的 attempt result 与 decision log 查到 verdict/feedback/rubric/run/round/SHA/digest。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario callback

- [ ] [BEHAVIOR] [L2] callback 重放、recovery/resume 与并发 run 隔离幂等（Golden Path Step 3）
  动作: 同 digest 重放两次、不同 digest 重放一次，并建立第二个 run 后清理结果文件再 recovery。
  预期观察: within 60s 同 digest 仅一条 DB authority；冲突 409；跨 run 零互读；recovery 得到原 digest。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario replay-isolation

- [ ] [BEHAVIOR] [L2] fresh-session round 2 精确收到 prior review 与 resolution map（Golden Path Step 4）
  动作: 从 round 1 persisted reviewer result 重建 ground truth，再派发 proposer 与 reviewer round 2。
  预期观察: within 60s 两个 task bundle 精确绑定同 run、round 1、contract SHA、source attempt、digest；reviewer 的每个 feedback id 有且仅有一个 resolution item。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario round2-lineage

- [ ] [BEHAVIOR] [L2] stale/wrong/missing/secret/CoT/超限 fail-closed，首轮与 legacy 显式 no-history（Golden Path Step 5）
  动作: 逐一提交 stale SHA、wrong run、wrong round、缺文件、逃逸、secret、transcript 和超限输入，并派首轮/legacy bundle。
  预期观察: 非法输入均失败且 DB 零污染；首轮=`first-round`，legacy=`legacy-unbound`，不得出现伪空反馈。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario invalid-and-legacy

- [ ] [BEHAVIOR] [L2] APPROVED 使用同一 authority 链且人工批准前阻断 release（Golden Path Step 6）
  动作: 提交 SHA 匹配和 stale 的 APPROVED；对首次 P0 Controller contract 分别在人工批准前后运行 release handler。
  预期观察: 仅匹配 APPROVED 进入 allow；批准前 merge/deploy 均零调用，批准后各一次。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario approved-human-gate

- [ ] [BEHAVIOR] [L2] reviewer result schema 字段与 callback response keys 完整（Golden Path Step 2）
  动作: 真运行 sprint integration test 的 `read-only callback 持久化完整 reviewer 结果` 用例。
  预期观察: result 的 decision 含 outcome/reason/binding/feedback/rubric，callback success keys 完全等于 deduped/ok/attemptId。
  Test: manual:bash npx vitest run sprints/07272206-kernel-0cb0dd5b/tests/kernel-result-feedback-lineage.integration.test.ts -t 'read-only callback 持久化完整 reviewer 结果'

- [ ] [BEHAVIOR] [L2] 禁用字段不存在且确定性截断不改变 authority（Golden Path Step 5）
  动作: 两次提交相同长描述，并提交含 transcript/chain_of_thought/secret 的变体。
  预期观察: 合法长描述两次 canonical digest 相同，verdict/binding 不变；禁用变体拒绝且未入账。
  Test: manual:bash npx vitest run sprints/07272206-kernel-0cb0dd5b/tests/kernel-result-feedback-lineage.integration.test.ts -t '确定性截断保留 verdict/binding 且禁 transcript'

- [ ] [BEHAVIOR] [L2] 全链路 proven-to-fire 套件覆盖 PRD 七组回归（Golden Path Step 1-6）
  动作: 对当前未实现基线先确认 Red；Generator 实现后运行 callback、round2、跨 run、stale、missing、APPROVED、legacy 全套。
  预期观察: 未实现时因生产模块缺失明确 FAIL；实现后 9 个 it 全通过，不允许 skip。
  Test: manual:bash npx vitest run sprints/07272206-kernel-0cb0dd5b/tests/kernel-result-feedback-lineage.integration.test.ts

## Invariant 铁律逐条映射

- INV-1 `[超时恢复]`：N/A — 本 Sprint 不修改 watchdog overdue/orphan requeue；既有 recovery 测试必须保持绿。
- INV-2 `[语义成功]`：映射 Golden Path Step 2；callback 成功必须看 schema/binding/persistence，不只看 `ok:true`。
- INV-3 `[依赖修复]`：N/A — 不新增第三方 npm 依赖；若 audit 翻红按既有 DevGate 处理。
- INV-4 `[会话心跳]`：N/A — 不修改 headed relay 长 CI 心跳。
- INV-5 `[毕业门禁]`：映射 ARTIFACT；Red commit 后先跑 `lint-tdd-commit-order` 与 `check-test-coverage`。
- INV-6 `[真实退出]`：映射 Golden Path Step 1-6；RCI 必须记录每个 manual oracle 的真实 exit code。
- INV-7 `[命令真跑]`：映射最终 E2E；全部 manual node/bash 命令必须真跑，不以 `bash -n` 代替。
- INV-8 `[冒烟铁律]`：映射 ARTIFACT RCI；Brain 源码变更必须提供并登记 smoke。
- INV-9 `[冒烟铁律-重复2]`：同 INV-8，来自 controller 重复铁律，显式保留。
- INV-10 `[多轮测试]`：映射 Golden Path Step 3-4；round 1→2 与 recovery 使用不重置的真实 DB 状态。
- INV-11 `[重扫幂等]`：N/A — 不调用付费外部服务；callback replay 幂等由 INV-10/Golden Path Step 3 覆盖。
- INV-12 `[时间关系]`：N/A — 不新增跨模块定时常数；60s/600s 仅验收预算。
- INV-13 `[环境剧场]`：映射 E2E `target_environment=local_api`，真实 PostgreSQL/callback，不改环境绕过。
- INV-14 `[环境来源]`：映射 ARTIFACT；target_environment 继续来自 task payload，contract 不写死生产机器。
- INV-15 `[结果格式]`：N/A — 本 Sprint 不修改 Brain judge 的 exit_code/log_tail/behavior_tests schema。
- [ ] [BEHAVIOR] [L2] INV-16 长度边界：定长/有界字段入账前确定性限长（Golden Path Step 2/5）
  动作: 提交边界值、超长描述和超过 262144 bytes 的结果文件。
  预期观察: 边界值可持久化且 digest 稳定；描述按规则截断；原始超限拒绝，DB 不出现半截 authority。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario invalid-and-legacy
- INV-17 `[历史实证]`：N/A — 不复活退役功能；已读取 callback/dispatcher/ground-truth 历史与相关 commit。
- [ ] [BEHAVIOR] [L2] INV-18 失败分支：文件/DB/helper 返回 null/false 必须显式失败（Golden Path Step 2/5）
  动作: 令结果文件缺失、attempt 不存在、terminal write 返回空行。
  预期观察: 各路径返回稳定 4xx/409/非零，不进入后续 feedback 派发。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario invalid-and-legacy
- INV-19 `[冒烟铁律-重复3]`：同 INV-8，显式映射 RCI。
- INV-20 `[进度探针]`：N/A — 不修改 journey_features report 探针。
- [ ] [BEHAVIOR] [L2] INV-21 完成校验：容器 exit 0 但结果文件缺失不得完成 attempt（Golden Path Step 2/5）
  动作: 让 read-only role 进程 exit 0 但不创建 `BRAIN_RESULT_FILE`。
  预期观察: attempt 终态不是 completed，错误码为 missing result，下一 hop 不派发。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario invalid-and-legacy
- INV-22 `[接管核对]`：N/A — 本 Sprint 不改 headed host 白名单。
- INV-23 `[点火锚定]`：N/A — 不修改 headed relay 点火/base_repo/pr_url。
- INV-24 `[退役证据]`：N/A — 无功能退役。
- INV-25 `[后台告警]`：映射失败语义；cleanup/recovery catch 必须计数且连续失败进入既有告警。
- INV-26 `[表名认领]`：映射禁 mock 边；优先扩展 `harness_attempts.result` 与 decision log，不建第二 verdict SSOT；若加表须先审全部写入方。
- INV-27 `[真实消费]`：映射 Golden Path Step 4；持久化反馈的真实消费方为下一轮 proposer/reviewer dispatcher。
- INV-28 `[多端完整]`：N/A — 不修改多设备业务字段。
- INV-29 `[语义一致]`：映射 Golden Path Step 2/4；callback 判定与 ground-truth 注入使用同一 canonical binding/digest 策略。
- INV-30 `[引用验真]`：映射 Golden Path Step 2/5；contract SHA 必须精确 40-hex 且与远端 tip/服务端 bundle 对账。
- [ ] [BEHAVIOR] [L2] INV-31 生产隔离：集成测试使用隔离 DB/临时目录且阻断生产资源（Golden Path Step 1-6）
  动作: RCI 创建随机隔离数据库和临时 result root，执行后清理。
  预期观察: 所有测试行都带随机 run/attempt；生产 DB 无新增测试行；临时数据库与目录被删除。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario all
- INV-32 `[部署失败]`：映射 Golden Path Step 6；release 任一失败非零且不降级 warning。
- INV-33 `[生产真相]`：映射 Golden Path Step 2/4；authority 基准是 DB attempt + origin SHA，不使用 workspace diff。
- INV-34 `[测试质量]`：映射 Test Contract；异步文件/DB/callback 测试使用真实 await，不以源码 grep 充当 BEHAVIOR。
- INV-35 `[合同表格]`：映射 contract-draft `## Test Contract`，test file 路径为真实 sprint test。
- INV-36 `[红测提交]`：映射交付流程；Red commit 只暂存本 sprint tests。
- INV-37 `[调度回归]`：映射 Golden Path Step 4；dispatcher 接线既有回归 + proven-to-fire integration 双证据。
- INV-38 `[调度入口]`：N/A — 不新增 cron。
- INV-39 `[合并权限]`：映射 Golden Path Step 6；Generator 只推 PR，禁止自行 merge。
- INV-40 `[环境透传]`：映射 Golden Path Step 1；`BRAIN_RESULT_FILE`、attempt/run/lease env 必须显式注入 detached/remote 子进程。
- INV-41 `[历史核对]`：映射已知约束；已核对当前 Kernel dispatcher/callback/ground-truth 和历史 reviewer SHA 断言。
- INV-42 `[共享禁区]`：映射范围；未经本合同授权不得修改共享 CI 判定文件，仅新增并登记本 RCI。
- [ ] [BEHAVIOR] [L2] INV-43 提前合并：approval 与实际 contract head SHA 必须一致（Golden Path Step 5/6）
  动作: 在 APPROVED 后移动 branch tip，再运行 approval/release gate。
  预期观察: stale APPROVED 被拒，merge/deploy 调用计数为 0。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario approved-human-gate
- INV-44 `[冒烟铁律-重复4]`：同 INV-8，显式映射 RCI。
- INV-45 `[源码冒烟]`：映射 ARTIFACT；Brain src 变更必须新增 RCI 并在登记中可执行。
- INV-46 `[类型接线]`：N/A — 不新增 task_type。
- INV-47 `[存活双信号]`：N/A — 不新增宿主常驻服务。
- INV-48 `[常驻域]`：N/A — 不新增美国 Mac mini 常驻服务。
- INV-49 `[服务清单]`：N/A — 不新增 launchd 服务。
- INV-50 `[冒烟铁律-重复5]`：同 INV-8，显式映射 RCI。
- INV-51 `[单槽串行]`：映射 task-plan；默认单 `ws1` 写实现，测试读取可并行但实现者只有一个。
- INV-52 `[环境推导]`：映射 Golden Path Step 1；result root/host/worktree 路径从服务端配置与 attempt 派生，不写死宿主坐标。
- INV-53 `[真环境验]`：映射接缝清单；local Docker + 真 PostgreSQL RCI 通过前只能标 `logic-done-pending`。
- [ ] [BEHAVIOR] [L2] INV-54 多租户/多 run 隔离：至少两个 run 互不串反馈（Golden Path Step 3）
  动作: 并行创建两个 run、两个 reviewer attempt 和不同 feedback。
  预期观察: 每个下一跳 bundle 只含自身 run 的 feedback/digest，交叉查询为 0。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario replay-isolation
- [ ] [BEHAVIOR] [L2] INV-55 凭据安全：secret 不进 git、DB、日志或 result（Golden Path Step 1/2/5）
  动作: 在结果中放入 token/password/private_key/authorization/cookie 字段和值模式。
  预期观察: callback 拒绝；DB result、decision log 与 RCI log 均查不到 canary secret。
  Test: manual:bash scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario invalid-and-legacy
- INV-56 `[日志脱敏]`：映射 INV-55；feedback/error log 只记录 error code、attempt id 和 digest，不记录原始内容/PII。
- INV-57 `[端点鉴权]`：映射 Golden Path Step 2；callback 继续要求 Bearer attempt token + lease owner，未认证请求 401。
- INV-58 `[租户隔离]`：映射 INV-54；本 Kernel 无 tenant 字段，以 run/attempt 作为隔离域，禁止跨 run 读取。

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。）

## 失败与通过标准

- PASS：所有 checkbox 保持未预勾，由 evaluator 真执行；`scripts/devgate/kernel-result-feedback-lineage-rci.sh --scenario all` exit 0；9 个 sprint integration tests 无 skip；相关既有 Kernel 回归全绿。
- FAIL：任一 manual 命令非零、缺结果文件却 completed、非法输入入账、同 attempt 多 authority、跨 run 串读、stale APPROVED 放行、或人工批准前 merge/deploy。
- 接缝未在 local Docker + 真 PostgreSQL 验过时只可标 `logic-done-pending`，不得标 done。
