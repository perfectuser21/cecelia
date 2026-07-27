---
skeleton: false
journey_type: dev_pipeline
target_environment: local_api
---
# Contract DoD — Sprint: Cecelia Harness Pipeline F1 账本归位与等价基线

**范围**: 现有 F1 Journey 原位 S0-S12 × 11 要素、legacy P0/P1 基线与唯一根回归引用；不改变 merge/staging/production 运行时。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 幂等 migration 365 存在，且只扩展既有 Journey/Step/Cell 模型
  Test: node -e "const fs=require('fs');const p='packages/brain/migrations/365_kernel_harness_f1_baseline.sql';const s=fs.readFileSync(p,'utf8');for(const x of ['bb8cc561-b3ee-4fec-b74d-2255694bd963','lifecycle_stage','is_backbone','journey_step_links'])if(!s.includes(x))process.exit(1);for(const x of ['CREATE TABLE kernel_steps','CREATE TABLE behavior_ledger','Kernel Harness Delivery'])if(s.includes(x))process.exit(1)"

- [ ] [ARTIFACT] 真 PostgreSQL integration 与 smoke 均已入册
  Test: node -e "const fs=require('fs');for(const p of ['packages/brain/src/__tests__/integration/migration-365-kernel-harness-f1-baseline.integration.test.js','packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh']){const s=fs.readFileSync(p,'utf8');if(!/HARNESS_TEST_DATABASE_URL|DATABASE_URL/.test(s))process.exit(1)}"

- [ ] [ARTIFACT] 根 regression-contract.yaml 登记 F1 逐项权威映射，engine 合同只作 legacy source
  Test: node -e "const fs=require('fs');const root=fs.readFileSync('regression-contract.yaml','utf8');for(const x of ['kernel_harness_f1_baseline:','legacy_behavior_id:','journey_stage:','element:','source_ref:','assertion_ref:'])if(!root.includes(x))process.exit(1);const engine=fs.readFileSync('packages/engine/regression-contract.yaml','utf8');if(!engine.includes('Regression Contract - ZenithJoy Engine'))process.exit(1)"

- [ ] [ARTIFACT] Brain 源码改动同步版本与 DEFINITION.md
  Test: node -e "const fs=require('fs');const d=fs.readFileSync('packages/brain/DEFINITION.md','utf8');const p=JSON.parse(fs.readFileSync('packages/brain/package.json','utf8'));if(!d.includes(p.version))process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] B1 Golden Path Step 1 只识别原 Cecelia Harness Pipeline
  动作: 在隔离 PostgreSQL 中以六个真实历史 ID 建 fixture，执行 migration 两次并查询同域 Journey。
  预期观察: within 180s 仅返回固定 Journey ID；`Kernel Harness Delivery` 与平行账本表均为 0。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh unique-journey'

- [ ] [BEHAVIOR] [L2] B2 Golden Path Step 2 保留历史并补齐 S0-S12
  动作: 在同一未重置事务中连续应用两轮 baseline，再经真 PostgreSQL 与真实 Brain GET 读取 backbone 与 history alias。
  预期观察: within 180s 六个历史 ID/Notion 关联不变，S0-S12 各一个 backbone，13 组稳定名称/promise 逐字匹配，Reviewer/Final E2E 仅为非 backbone 历史别名，第二轮无新增。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh history-and-backbone'

- [ ] [BEHAVIOR] [L2] B3 Golden Path Step 3 每个 backbone Step 恰有 11 个合法 element cells
  动作: 查询真 PostgreSQL 的 F1 backbone 与 element cells，并对 key、状态、重复行做聚合断言。
  预期观察: within 180s 共 143 格；每步 11 格；状态仅 `gray|red|pending|green|na`。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh cells-and-evidence'

- [ ] [BEHAVIOR] [L2] B4 Golden Path Step 3 静态声明不能把 cell 变 green
  动作: 运行 baseline 审计器并把 green cells 与当前 SHA 的真实 PASS envelope、根合同 test_command 交叉核对。
  预期观察: within 180s false-green 与 invalid assertion_ref 数组均为空；缺证据项保持 gray/red/pending。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh cells-and-evidence'

- [ ] [BEHAVIOR] [L2] B5 Golden Path Step 4 legacy P0/P1 四类来源逐项归位到根合同
  动作: 真读 engine P0/P1、hooks、DevGate/CI 与 Kernel gates 的去重发现集，并与根 regression-contract 的权威 behaviors 映射和真库 143 cells 对账。
  预期观察: within 180s discovered=mapped、unmapped=0、duplicate=0；每项含 legacy_behavior_id/priority/stage/element/双 owner/status/gap/order/source_ref/assertion_ref，派生 JSON authoritative=false。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh legacy-baseline'

- [ ] [BEHAVIOR] [L2] B6 Golden Path Step 5 非空 assertion_ref 全部可追到唯一根合同或真实测试
  动作: 对 F1 cells 与根 baseline behaviors 的 assertion_ref 逐条解析唯一根 regression entry，并检查 test_command 目标真实存在。
  预期观察: within 180s 悬空/重复/静态文档引用均为 0；source_ref 与 assertion_ref 分工明确；engine YAML 未成为第二 SSOT。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh assertion-refs'

- [ ] [BEHAVIOR] [L2] B7 Golden Path Step 6 真实 Brain endpoint 显示 merge 不等于 completed
  动作: 用隔离数据库启动真实 Brain 到独立端口，curl 固定 Journey，并用 jq 检查 endpoint。
  预期观察: within 180s HTTP 200，endpoint 同时表达 production verified、rollback anchor、report/learning。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh endpoint-semantics'

- [ ] [BEHAVIOR] [L2] B8 Golden Path Step 7 既有 merge staging production 行为零回退
  动作: 执行 baseline smoke 与现有 completion/finalize/staging 回归，比较 migration 前后运行时表 fingerprint。
  预期观察: within 240s 运行时表 fingerprint 相同、既有回归 exit 0、派生报告声明 authoritative=false。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh runtime-nonregression'

## 铁律逐条映射

- INV-01 超时恢复 — N/A：本 sprint 不改 relay watchdog/orphan requeue。
- INV-02 语义成功 — N/A：不新增通知/写库成功回执接口；DB 断言直接核对持久化事实。
- INV-03 依赖修复 — N/A：不修改依赖或 advisory 白名单。
- INV-04 会话心跳 — N/A：不改 headed relay/CI 等待。
- INV-05 毕业检查 — N/A：由现有 DevGate 流程执行，不属于 F1 baseline 运行时产物。
- INV-06 手工证据 — N/A：GAN 阶段只交合同模板；evaluator 执行时由 behavior_tests 记录真实 exit code。
- INV-07 真跑脚本 — N/A：本合同不使用 `manual:node -e` 作为 BEHAVIOR oracle。
- INV-08 冒烟一 — N/A：decision 6041333c 未指向本单模块；本单另有真库 smoke。
- INV-09 冒烟二 — N/A：decision a3989e96 未指向本单模块；本单另有真库 smoke。
- INV-10 多轮测试 — 映射到 B2：同一未重置事务中连续应用两轮，验证真实多轮幂等。
- INV-11 付费去重 — N/A：不引入第三方或付费调用。
- INV-12 时间关系 — N/A：不新增跨模块时间常数。
- INV-13 环境剧场 — 映射到 B1-B8：合同与 task payload 均为 `local_api`，真实服务为 Brain + PostgreSQL。
- INV-14 环境真相 — 映射到 B1-B8：`target_environment=local_api` 已写入 task-plan 与 DoD frontmatter。
- INV-15 判决格式 — N/A：不修改 Brain judge 输出协议。
- INV-16 字段长度 — 映射到 ARTIFACT migration：新增 stage/status 使用 CHECK 枚举，文本审计字段不写入受限短列。
- INV-17 退役溯源 — N/A：不复活已退役功能；只按当前 legacy source 分类。
- INV-18 失败分支 — 映射到 B4-B6：审计缺失/无效返回必须非零或 fail-closed，不能靠 try/catch 吞错。
- INV-19 冒烟三 — N/A：decision 33ede9f1 未指向本单模块；本单另有真库 smoke。
- INV-20 收账探针 — N/A：本刀只建基线，不实现 report freshness patrol。

- [ ] [BEHAVIOR] [L2] INV-21 完成核验要求外部产出而非容器 exit 0
  动作: 执行 Golden Path Step 6 的真实 Brain GET 和 Step 7 的审计/回归校验。
  预期观察: within 240s 只有 endpoint、rollback/report 证据和全部真实断言通过才 exit 0。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh runtime-nonregression'

- INV-22 场景核对 — N/A：不增加 host 白名单或 headed 人工接管场景。
- INV-23 点火锚点 — N/A：不改 headed relay 点火。

- [ ] [BEHAVIOR] [L2] INV-24 退役事实来自真实 legacy source
  动作: 真读 engine 合同、根合同和测试路径生成 Step 4 基线，不使用记忆或硬编码乐观状态。
  预期观察: within 180s 无证据条目为 unknown/drifted，不会被默认归为 retired/active。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh legacy-baseline'

- INV-25 吞错告警 — N/A：不新增后台常驻任务；审计 CLI 失败直接非零。

- [ ] [BEHAVIOR] [L2] INV-26 复用共享表前核对全部写入方且不建同义表
  动作: 运行唯一 Journey/禁表断言，并执行 journeys 现有 route/integration 回归。
  预期观察: within 180s 只复用 journeys/journey_steps/journey_step_links，平行表计数为 0。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh unique-journey'

- INV-27 消费闭环 — N/A：不新增后台任务。
- INV-28 多端完整 — N/A：真实运行环境单一为 local_api，不涉及设备/OS 分支。

- [ ] [BEHAVIOR] [L2] INV-29 cell 状态判定与终验采用同一五态策略
  动作: 让 ledger classifier、DB CHECK 与 smoke 对同一 143 cells 执行一致状态校验。
  预期观察: within 180s 三处均只接受 `gray|red|pending|green|na`，无别名状态漂移。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh cells-and-evidence'

- INV-30 引用验证 — N/A：本 sprint 不消费动态 git ref；证据 SHA 来自已解析的当前 commit，不接受用户传入 ref。

- [ ] [BEHAVIOR] [L2] INV-31 真 worktree 测试必须隔离生产资源
  动作: 在任何写入前查询 `current_database()` 并执行 `_test|preview_` guard。
  预期观察: within 10s 非隔离库立即非零且零写入；隔离库才继续 baseline。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; DB=$(psql -X -qAt "$HARNESS_TEST_DATABASE_URL" -c "SELECT current_database()"); case "$DB" in *_test|preview_*) exit 0;; *) echo "FAIL: non-isolated db=$DB"; exit 1;; esac'

- INV-32 部署失败 — N/A：不修改部署链；smoke 自身所有失败非零。
- INV-33 生产自报 — N/A：不做生产部署判变。
- INV-34 测试异步 — 映射到 Test Contract：所有真 DB/API 测试 await 被测异步函数和查询。
- INV-35 合同表格 — 映射到 contract-draft.md：Test Contract 固定四列且 testFile 使用反引号。
- INV-36 红测提交 — N/A：属于 Generator 提交流程；task-plan 要求 TDD Red→Green，controller/DevGate 执法。
- INV-37 调度验证 — N/A：不改调度；本合同的 DB/API 接缝均真验。
- INV-38 定时入口 — N/A：不新增 cron。
- INV-39 合并权限 — N/A：Generator 只交 PR，controller 持有 merge 权。
- INV-40 环境继承 — N/A：不改 headed relay/tmux。
- INV-41 先例核对 — 映射到 contract-draft.md 已知约束：已核对 migration 349/350、journeys route 与当前真实派发环境。
- INV-42 共享禁区 — N/A：task-plan 未授权修改共享 CI 判定文件。
- INV-43 合并漂移 — N/A：不改 CI/merge gate。
- INV-44 冒烟四 — N/A：decision 552520d0 未指向本单模块；本单另有真库 smoke。

- [ ] [BEHAVIOR] [L2] INV-45 Brain 源码改动同时提供 smoke 与现有门禁登记
  动作: 执行 F1 baseline smoke，并从根 regression contract 运行对应 KH-F1 条目。
  预期观察: within 240s smoke exit 0，根合同存在可运行 test_command，Brain 版本/DEFINITION 同步。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh runtime-nonregression'

- INV-46 任务接线 — N/A：不新增 task_type。
- INV-47 存活双信 — N/A：不新增服务存活判定。
- INV-48 常驻域 — N/A：不新增 LaunchDaemon。
- INV-49 巡检登记 — N/A：不新增宿主服务。
- INV-50 冒烟五 — N/A：decision 4b73376c 未指向本单模块；本单另有真库 smoke。
- INV-51 单槽串行 — N/A：由 Harness controller 执法；task-plan 仅 ws1。

- [ ] [BEHAVIOR] [L2] INV-52 数据库与 Brain 端口必须从环境推导
  动作: smoke 从 `HARNESS_TEST_DATABASE_URL` 读取数据库，并动态选择独立 Brain 端口，禁止写死生产连接。
  预期观察: within 180s 缺变量或目标非测试库立即失败；合法环境完成真实查询。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 180 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh unique-journey'

- [ ] [BEHAVIOR] [L2] INV-53 接缝仅在真实 local_api 目标验过后才可 done
  动作: 在隔离真 PostgreSQL应用 migration，并启动真实 Brain 运行 Step 1-7。
  预期观察: within 240s 真 DB/API 全过才 exit 0；否则保持 logic-done-pending。
  验证命令: Test: manual:bash -c ': "${HARNESS_TEST_DATABASE_URL:?}"; timeout 240 bash packages/brain/scripts/smoke/kernel-harness-f1-baseline-smoke.sh runtime-nonregression'

- INV-54 租户测试 — N/A：F1 承诺地图为全局工厂元数据，不读取或写入租户业务数据。
- INV-55 凭据安全 — N/A：不新增凭据处理；所有连接串只来自环境且 smoke 不打印。
- INV-56 日志脱敏 — N/A：baseline 不读取客户 PII/聊天内容，审计输出只含合同元数据与路径。
- INV-57 端点鉴权 — N/A：不新增 endpoint；只读复用现有内部 journeys 路由，鉴权改造超出本刀范围。
- INV-58 租户隔离 — N/A：本单不涉及租户数据查询/写入。

## BEHAVIOR:E2E 条目

- [ ] [BEHAVIOR:E2E] local_api evaluator 在隔离 PostgreSQL + 真实 Brain 上走完七步
  期望: `.brain-result` 记录每条 behavior 的真实 exit_code/log_tail；七步全过后才 PASS。
