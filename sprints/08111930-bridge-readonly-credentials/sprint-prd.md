# Sprint PRD — 宿主 bridge 凭据只读消费（消除多写入者竞态根因）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环
- **当前进度**：82%
- **本次推进预期**：+2%（消除 harness attempt 因权威 token 过期同时判死的根因）

## 背景

宿主侧 bridge（`cecelia-bridge.js` /llm-call）在宿主直接用权威目录 `~/.claude-account{N}`
起 claude，claude CLI 会按自身逻辑刷新并**回写权威 credentials.json**。多写入者存在 →
`infrastructure` 的 refresh-claude-tokens.sh 探测到活跃会话就整体让位
（`SKIP:live_interactive_session_owns_refresh`，由决策 4ce29c14 背书：多刷新者迟早互相
覆盖导致 invalid_grant）→ 让位期空窗 → 2026-08-10 三条 run（e674f58a/a94fff75/643b5302）
attempt 各 384ms 死于 "Not logged in"。根因 = 派出去的执行体会回写，逼得刷新器不敢刷。
容器路径（docker-executor :ro 挂载 + 可写副本）与 Codex 路径（credential-envelope/v1）已对，
本 sprint 把同一「只读消费」模式补齐到宿主 bridge。

## Golden Path（核心场景）

系统从 [Brain 经 bridge 派发一次 attempt] → 经过 [bridge 复制独立临时 config dir，claude 只写副本] → 到达 [attempt 结束，权威文件 mtime/sha256 前后完全不变、临时副本被清理]

具体：
1. [触发条件] Brain llm-caller 携带 accountId POST bridge `/llm-call`（localhost:3457）
2. [系统处理] bridge 不再把 `CLAUDE_CONFIG_DIR` 指向权威目录 `~/.claude-account{N}`；改为按 attempt 从权威目录复制出一份独立临时 config dir，`CLAUDE_CONFIG_DIR` 指向该临时目录后再 spawn claude
3. [系统处理] claude 进程的一切刷新/写入只落在临时副本，权威文件在整个 attempt 生命周期内只被读取
4. [系统处理] attempt 结束后清理临时副本；清理失败只记日志、不影响主流程结果
5. [可观测结果] 权威文件 `~/.claude-account{N}/.credentials.json` 的 mtime 与内容 sha256 前后完全不变；临时目录已被创建并已清理

## 边界情况

- 临时目录**创建失败** → attempt 主流程应失败并告警（不得回退到直接用权威目录）
- 临时目录**清理失败** → 仅记日志，不影响 attempt 结果
- **并发** → 并行两个 bridge attempt 必须各自使用互不相同的临时目录，权威文件仍未被写
- 无 accountId（默认账号）分支同样走临时副本，不得直接使用 `~/.claude-account1`

## 范围限定

**在范围内**：仅宿主 bridge（`cecelia-bridge.js` /llm-call 起 claude 时）的 Claude 凭据投递方式改为只读消费临时副本 + 结束清理 + 权威文件只读断言。

**不在范围内**：不动容器路径（docker-executor）、不动 Codex 信封、不动 gear 分档、不动 evaluator/judge/mergeGate；不改 `infrastructure` 仓库任何文件（含 refresh-claude-tokens.sh）；不做「自动切换未过期账号」；本 PR 不收窄让位逻辑（仅在产出中记录第 1 步完成后让位前提已消失、可另行提案，供主理人修订决策 4ce29c14）。

## 假设

- [ASSUMPTION: 权威账号目录命名为 `~/.claude-account{N}`，凭据文件为其下 `.credentials.json`（与 docker-executor.js:330 一致）]
- [ASSUMPTION: 临时副本按 attempt 唯一命名（如含 pid/时间戳/随机后缀），保证并发不撞目录]
- [ASSUMPTION: 复制需覆盖 claude CLI 刷新所需文件（credentials + 相关 config），对齐容器 entrypoint.sh 既有复制做法]

## 预期受影响文件

- `packages/brain/scripts/cecelia-bridge.js`: /llm-call 起 claude 前建临时 config dir 并指向它、结束清理（核心，line 95-98 现直接用权威目录）
- `packages/brain/scripts/cecelia-bridge.cjs`: 若为同源第二实现，需同步同一模式（避免遗漏）
- `packages/brain/src/__tests__/`（新增）: bridge 只读消费的单测（临时目录创建失败=失败告警、清理失败=仅记日志）
- 集成/并发验收脚本（本 PR 产出）: 权威文件 mtime+sha256 不变断言、临时目录创建/指向/清理断言、并发目录互异断言

## E2E 验收

> Planner 初稿此区块留占位，最终可执行脚本由 proposer 在 GAN 阶段按 target_environment=local_api 填 curl/node/psql。

```bash
# 占位：proposer 将填入真实脚本（local_api → node 集成测试 + fs mtime/sha256 断言 + 并发起两 attempt）
# 期望验收点（自然语言）：
# 1) 记录 ~/.claude-account{N}/.credentials.json 的 mtime + sha256 → 经 bridge 跑完一次 attempt → 断言 mtime 与 sha256 前后完全不变（任何变化即 FAIL，核心红线）
# 2) 同次 attempt 断言临时 config dir 被创建、claude 的 CLAUDE_CONFIG_DIR 指向该临时目录（非权威目录）、结束后该目录被清理
# 3) 单测：临时目录创建失败→主流程失败并告警；清理失败→仅记日志不影响结果
# 4) 并发：并行两个 bridge attempt→各自临时目录互不相同、权威文件仍未被写
# 5) 零回归：docker-executor 与 Codex 信封既有单测全绿、行为不变
```

## NFR 约束

<!-- 来源: decisions 表 category=nfr（step/feature 均空数组），PrepPRD 显式值优先 -->
- 权威文件写入次数: **0**（整个 attempt 生命周期只读，任何 mtime/sha256 变化即失败）
- 清理容错: 临时副本清理失败不得影响主流程结果，但须记日志
- 创建失败: 临时目录创建失败须使 attempt 失败并告警，禁止回退到直接用权威目录
- 并发隔离: 每个 attempt 一份独立临时 config dir，互不复用/互不覆盖
- 执行顺序（铁律）: 必须先落地并验证第 1 步（只读消费）后，才允许在后续独立提案中收窄让位逻辑；本 PR 内严禁绕过/削弱现有让位逻辑（顺序颠倒 → 重新引入 invalid_grant）

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，step(空) + journey_feature(空) + area 三源合并去重 -->
- [不回写权威] 派出去的执行体只读消费凭据，权威文件只有一个写入者（refresh-claude-tokens.sh）；bridge 起的 claude 写不回权威 credentials.json（来源: 本 sprint 根因 + 决策 4ce29c14）
- [顺序不可颠倒] 第 1 步未验证前不得触碰让位逻辑；本 PR 不改 infrastructure 仓库（来源: task 硬约束）
- [judge证据分流] judge FAIL 先区分「证据压缩窗口截断」与「实现缺陷」：evidence_insufficient 优先走 evaluator 补证轮而非改代码（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: 本 line 已完成 ability 的 golden_path，按 ability 分组、order_no 排序 -->
（本 line 暂无历史 golden-path 记录，journey e6f803f2 golden-paths 返回空；既有对照模式非本 line 的累积 FR：容器路径 :ro 挂载+可写副本、Codex credential-envelope/v1 只读消费——本 sprint 不得破坏此两条既有行为）

## journey_type: agent_remote
## journey_type_reason: 本 sprint 改宿主 bridge 派发执行体（claude）的凭据投递方式，命中 agent_remote（bridge/远端执行体协议）分支
## target_environment: local_api
## target_environment_reason: 纯宿主后端 node 集成（fs mtime/sha256 断言 + spawn bridge attempt + 并发），本地 evaluator 跑，非 UI/Windows/微信/生产部署
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116
