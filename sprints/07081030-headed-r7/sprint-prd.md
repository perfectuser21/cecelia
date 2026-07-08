# Sprint PRD — relay-demo: pretty-bytes 小工具（headed R7·team1 完整收尾）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：用一个非核心路径、纯 CLI 可验的小改动验证 headed R7 在 team1 满额度下能完整收尾，降低派发链路的系统性不确定性

## 背景

本次 sprint 不是扩展核心业务能力，而是为 headed R7 提供一个足够小、足够干净的真实改动载体，验证 relay-demo 场景能从规划、实现、测试到合入完整跑通。PrepPRD 已锁定范围：只新增 `scripts/relay-demo/pretty-bytes.mjs` 及其测试，所有断言必须 CLI 可验，不引入视觉步骤，也不触碰 `packages/brain/src` 与 migrations。

## Golden Path（核心场景）

开发/验证链路从 [执行字节格式化脚本与测试] → 经过 [将原始字节数转换为人类可读字符串并由 vitest 覆盖三类边界值] → 到达 [CLI 侧确认功能正确且 headed R7 可完整收尾]

具体：
1. [触发条件] 调用方在本地执行 `scripts/relay-demo/pretty-bytes.mjs`，并运行针对该脚本的 vitest 用例
2. [系统处理] 脚本把输入字节数转换为人类可读格式，测试覆盖 `0`、`1024`、`TB` 三个代表性场景
3. [可观测结果] CLI 输出与测试断言一致，vitest 三 case 全绿，且改动范围保持在 `scripts/relay-demo/` 与 `sprints/07081030-headed-r7/`

<!-- Response Schema由Proposer在Step 1.1读api_registry后推导，Planner不负责定义技术规范。 -->

## 边界情况

- 输入为 `0` 时，结果必须稳定返回可读的零值表示，不能报错或返回空字符串
- 输入跨过 `1024` 阈值时，结果必须完成单位进位，避免仍以字节原值展示
- 输入达到 `TB` 量级时，结果必须继续输出可读单位，避免溢出、截断或回退到错误单位
- 非核心路径演练不得扩张为通用格式化库改造；本 sprint 只锚定 thin_prd 已写明的脚本与三条测试

## 范围限定

**在范围内**：新增 `scripts/relay-demo/pretty-bytes.mjs`；补齐该脚本的 vitest 三个用例（`0` / `1024` / `TB`）；保证全部断言可通过 CLI 验证；保持 headed R7 演练改动集中在 `scripts/relay-demo/` 与本 sprint 合同目录。
**不在范围内**：修改 `packages/brain/src`；修改 migrations；引入视觉界面或浏览器验收；扩展为更多格式化规则、更多单位策略或通用 npm 包发布；变更核心业务路径。

## 假设

- [ASSUMPTION: 仓库现有测试基建已支持为 `scripts/relay-demo/` 新增 vitest 用例，无需本 sprint 额外改造测试框架]
- [ASSUMPTION: `pretty-bytes.mjs` 的调用方式以 Node.js CLI 可直接执行为准，验收不依赖 HTTP、数据库或浏览器]
- [ASSUMPTION: `step_id` 在本次 PrepPRD 中未显式下发，先以 `headed-r7-team1` 作为 Golden Path 锚定代码]

## 预期受影响文件

- `scripts/relay-demo/pretty-bytes.mjs`: 新增字节数转人类可读字符串的小工具脚本
- `scripts/relay-demo/`: 新增对应 vitest 用例文件，覆盖 `0`、`1024`、`TB` 三个场景

## NFR 约束

<!-- 来源: decisions 表 category=nfr（本次为空），PrepPRD 显式值优先 -->
- 超时/延迟: 待定（PrepPRD 未指定）
- 频控: 不适用（本 sprint 为本地 CLI 脚本与测试）
- 版本要求: 待定（PrepPRD 未指定）
- 可观测: 全部断言必须 CLI 可验；无视觉步骤

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step + journey_feature + area 三源合并去重；本次仅 area 有数据 -->
- [单槽串行] 一个 slot/会话内严格串行执行任务，并行只许跨 slot（来源: area）
- [禁写死环境] 屏幕外坐标、阈值、假设调用方传值、假设环境变量存在等环境假设值禁止写死，要么从环境推导要么真机校准（来源: area）
- [真环境验证] 依赖真实目标环境的接缝断言，未真验前只能标 logic-done-pending，不能标 done（来源: area）
- [多租户测试] 单元或 E2E 测试默认种至少两个租户并断言互不串扰（来源: area）
- [凭据安全] secrets 不硬编码、不进 git、不进日志（来源: area）
- [日志脱敏] 客户隐私、PII、聊天内容不得明文进入日志（来源: area）
- [端点鉴权] 每个 API 端点必须有 auth；无鉴权端点不准 ship（来源: area）
- [租户隔离] 触及租户数据的查询与写入必须严格 scope 到当前租户（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path；本次 journey_id 查询为空 -->
- （本 line 暂无历史）

## E2E 验收

> Planner 初稿此区块只写占位与自然语言验收点。最终可执行脚本由 proposer 按 target_environment=local_api 翻译为本地 CLI / Node / vitest 命令。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本
# 期望验收点（自然语言）：
#   1. 直接执行 scripts/relay-demo/pretty-bytes.mjs 时，可对输入字节数给出人类可读结果。
#   2. vitest 三个用例覆盖 0、1024、TB，且全部通过。
#   3. 改动文件仅落在 scripts/relay-demo/ 与 sprints/07081030-headed-r7/。
#   4. 全流程无需视觉操作，CLI 输出即可证明成功。
```

## journey_type: autonomous
## journey_type_reason: thin_prd 未命中 dashboard、agent 协议或 packages/engine，且本次为本地脚本与测试的后端式自动化演练，按规则默认归入 autonomous
## target_environment: local_api
## target_environment_reason: 该 sprint 的成功信号完全来自本地 CLI、Node 与 vitest，无需浏览器、远端服务器或真机，且 Brain payload 已明确给出 local_api
## journey_id: bb8cc561-b3ee-4fec-b74d-2255694bd963
## step_id: headed-r7-team1
