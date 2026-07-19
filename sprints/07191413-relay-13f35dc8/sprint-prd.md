# Sprint PRD — relay-demo: slugify 小工具（claude headed 中继链路自测）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：用一个非核心路径、纯 CLI 可验的小改动验证 claude 执行器在 headed 模式下走完整条 harness-controller relay（planner→GAN→generator→evaluator→judge→merge→report）能否跑通，降低派发链路的系统性不确定性

## 背景

本次 sprint 的 Brain task payload 中 `thin_prd` 与 `description` 均为空，属于"headed 中继链路自测"任务（对照同批 codex-headed-smoke 任务），目的不是交付具体业务需求，而是验证 relay 全链路。参照仓库先例 `sprints/07081030-headed-r7/sprint-prd.md`（pretty-bytes 小工具）与已存在的 `scripts/relay-demo/sort-json-keys.mjs`（另一 relay 演练产物），本次选取与两者均不冲突的新纯函数工具：字符串转 URL-safe slug。所有断言必须 CLI/vitest 可验，不引入视觉步骤，不触碰 `packages/brain/src` 与 migrations。

## Golden Path（核心场景）

开发/验证链路从 [执行 slugify 脚本与测试] → 经过 [将任意字符串转换为 URL-safe slug 并由 vitest 覆盖三类边界值] → 到达 [CLI 侧确认功能正确且 claude headed relay 可完整收尾]

具体：
1. [触发条件] 调用方在本地执行 `scripts/relay-demo/slugify.mjs`，并运行针对该脚本的 vitest 用例
2. [系统处理] 脚本把输入字符串转换为小写、以连字符分隔、去除首尾多余连字符的 slug，测试覆盖"空字符串"、"含空格与标点的普通短语"、"含连续空格/连字符与非 ASCII 字符"三个代表性场景
3. [可观测结果] CLI 输出与测试断言一致，vitest 三 case 全绿，且改动范围保持在 `scripts/relay-demo/` 与 `sprints/07191413-relay-13f35dc8/`

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 输入为空字符串时，结果必须稳定返回空字符串，不能报错或抛异常
- 输入含连续空格、连续连字符或首尾空白时，结果必须折叠为单个连字符并去除首尾多余连字符
- 输入含非 ASCII 字符（如中文、emoji）时，结果必须给出确定性处理（保留或剔除均可，但需在实现中一致且被测试覆盖），不能崩溃或输出不可预测值
- 非核心路径演练不得扩张为通用字符串处理库改造；本 sprint 只锚定上述脚本与三条测试

## 范围限定

**在范围内**：新增 `scripts/relay-demo/slugify.mjs`；补齐该脚本的 vitest 三个用例（空字符串 / 含空格标点的普通短语 / 含连续分隔符与非 ASCII 字符）；保证全部断言可通过 CLI 验证；保持本次演练改动集中在 `scripts/relay-demo/` 与本 sprint 合同目录。
**不在范围内**：修改 `packages/brain/src`；修改 migrations；引入视觉界面或浏览器验收；修改或覆盖已存在的 `scripts/relay-demo/pretty-bytes.mjs`、`scripts/relay-demo/sort-json-keys.mjs`；扩展为更多字符串处理规则、更多 Unicode 策略或通用 npm 包发布；变更核心业务路径。

## 假设

- [ASSUMPTION: 仓库现有测试基建已支持为 `scripts/relay-demo/` 新增 vitest 用例，无需本 sprint 额外改造测试框架]
- [ASSUMPTION: `slugify.mjs` 的调用方式以 Node.js CLI 可直接执行为准，验收不依赖 HTTP、数据库或浏览器]
- [ASSUMPTION: `step_id` 在本次 Brain payload 中未显式下发（`thin_prd`/`description` 均为空），先以 `claude-headed-smoke` 作为 Golden Path 锚定代码]

## 预期受影响文件

- `scripts/relay-demo/slugify.mjs`: 新增字符串转 URL-safe slug 的小工具脚本
- `scripts/relay-demo/`: 新增对应 vitest 用例文件，覆盖空字符串、普通短语、含连续分隔符/非 ASCII 三个场景

## NFR 约束

<!-- 来源: decisions 表 category=nfr（task 级 golden-path-decisions 与 ability 级均为空），PrepPRD 未指定（thin_prd 为空） -->
- 超时/延迟: N/A — 本地 CLI 脚本同步执行，无网络/IO 等待，无超时语义
- 频控: N/A — 本 sprint 为本地 CLI 脚本与测试，无外部调用频率场景
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 全部断言必须 CLI 可验；无视觉步骤

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本次 task 无 ability_id，step/feature 两源为空，仅 area 有数据（共 31 条，含 8 条 [系统] 铁律 + 21 条 capture-triage learning + 2 条 smoke 占位，全量列出不裁剪） -->
- [多端UI区分] 多设备类型(os_type/device_platform)UI区分必须在设计/审查阶段强制检查（来源: area）
- [capture-triage] [ ] 同一语义（如 git_sha=unknown）在判变端与终验端必须同一处理策略，跨脚本语义分叉会开假绿面…（来源: area）
- [capture-triage] [ ] `git rev-parse` 判 ref 存在必须带 `--verify "<ref>^{commit}"`，裸 rev-pars…（来源: area）
- [capture-triage] [ ] smoke/测试用真实 worktree 当 CECELIA_DEPLOY_ROOT 时，必须核对被测脚本会不会向上触碰生产资源…（来源: area）
- [capture-triage] [ ] 部署链任何失败路径禁止 warning 降级：显式 FAIL 变量 + Bark + exit 非零（set -uo 无 -e 的脚…（来源: area）
- [capture-triage] [ ] 判变基准永远用"生产实体自报"（build-info.json / health.git_sha）对账 origin/main，禁用…（来源: area）
- [capture-triage] lint-test-quality 要求 await fn() ≥ 1：讀源碼必須包裝 async function，不能直接 readFi…（来源: area）
- [capture-triage] Test Contract 表格固定 4 列格式，testFile 用 backtick 包裹，checker 從第 3 列解析路徑…（来源: area）
- [capture-triage] Red commit 必須只 git add 精確路徑（*.test.ts），禁止 git add . 或 git add .harness…（来源: area）
- [capture-triage] 回归测试用 source-code inspection 验证调度接线比 mock 覆盖更直接有效…（来源: area）
- [capture-triage] 新增 cron 功能首先检查 scheduler-jobs.js JOBS，tick-runner.js 是 deprecated 路径…（来源: area）
- [capture-triage] harness-generator 需新增铁律：禁止 generator 自行 merge PR，merge 权归 controller…（来源: area）
- [capture-triage] headed relay 的 tmux innerCmd 启动的子 shell 不自动继承父进程环境变量；凡需要在 Claude session…（来源: area）
- [capture-triage] Proposer 复用历史合同模板（尤其E2E验收断言）时必须先核对本次任务的真实派发/执行历史，不能假设与先例路径相同…（来源: area）
- [capture-triage] 给 harness-generator skill 增加共享 CI 基础设施文件默认禁区规则（.github/workflows/*.yml…）（来源: area）
- [capture-triage] PR 被 should-auto-merge.sh 等 CI 侧兜底机制在 evaluator/judge 跑完前提前合并时，必须用 PR…（来源: area）
- [smoke占位] smoke-invariant-1783850042-79911 — decision 字段仅为占位文本"smoke 铁律"，无实质约束内容（来源: area）
- [capture-triage] [ ] feat+brain/src PR 开 PR 前直接一次带齐 smoke.sh + smoke-allowlist 登记，别等 CI…（来源: area）
- [capture-triage] [ ] 新 task_type 接线用七点清单：CHECK 约束 / task-router 四表 / EXECUTOR_KIND_FOR…（来源: area）
- [capture-triage] [ ] 服务"该活着"的判定用双信号：launchctl 状态 + 端口监听（单看 launchd 漏 nohup 孤儿宕机）…（来源: area）
- [capture-triage] [ ] 本机（美国 Mac mini）禁止再往 `~/Library/LaunchAgents` 放需要常驻的服务——gui 域不存…（来源: area）
- [capture-triage] [ ] 新增常驻宿主服务时，必须同步加进 `packages/brain/src/launchd-patrol.js` 的 manifest…（来源: area）
- [smoke占位] smoke-invariant-1783693282-93097 — decision 字段仅为占位文本"smoke 铁律"，无实质约束内容（来源: area）
- [系统] 单 slot 串行任务，并行只许跨 slot（来源: area）
- [系统] 禁止写死环境假设值（来源: area）
- [系统] 真环境验证才算 done（来源: area）
- [系统] 测试默认多租户（来源: area）
- [系统] 凭据安全（来源: area）
- [系统] 日志脱敏（来源: area）
- [系统] 端点鉴权（来源: area）
- [系统] 租户隔离（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；journey_id=bb8cc561-b3ee-4fec-b74d-2255694bd963 查询结果为空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块只写占位与自然语言验收点。最终可执行脚本由 proposer 按 target_environment=local_api 翻译为本地 CLI / Node / vitest 命令。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#   1. 直接执行 scripts/relay-demo/slugify.mjs 时，可对输入字符串给出确定性的 URL-safe slug 结果。
#   2. vitest 三个用例覆盖空字符串、普通短语、含连续分隔符/非 ASCII 字符，且全部通过。
#   3. 改动文件仅落在 scripts/relay-demo/ 与 sprints/07191413-relay-13f35dc8/，且不覆盖已有的 pretty-bytes.mjs / sort-json-keys.mjs。
#   4. 全流程无需视觉操作，CLI 输出即可证明成功。
```

## journey_type: autonomous
## journey_type_reason: Brain payload 未含 dashboard、agent 协议或 packages/engine 路径线索，本次为本地脚本与测试的后端式自动化演练，按规则默认归入 autonomous
## target_environment: local_api
## target_environment_reason: 该 sprint 的成功信号完全来自本地 CLI、Node 与 vitest，无需浏览器、远端服务器或真机，对齐 Brain payload 中 mode=headed 但产物本身不涉及视觉验收
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: claude-headed-smoke
