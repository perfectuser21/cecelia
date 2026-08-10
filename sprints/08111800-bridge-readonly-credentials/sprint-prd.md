# Sprint PRD — 宿主 bridge 凭据只读消费（消除多写入者竞态根因）

## OKR 对齐

- **对应 KR**：Cecelia 基础稳固 — 系统可信赖、算力全开、管家闭环（进度 82%）
- **当前进度**：82%
- **本次推进预期**：+1%（消除 harness attempt 因权威 token 过期同时判死的根因）

## 背景

宿主 bridge（`cecelia-bridge.cjs` L167-181）当前把 `CLAUDE_CONFIG_DIR` 直接指向权威目录
`~/.claude-account{N}` 起 claude，该进程会 CLI 自刷新并**回写权威 credentials.json**——形成多写入者。
多写入者逼得 infrastructure 的 refresh-claude-tokens.sh 整体让位（`SKIP:live_interactive_session_owns_refresh`，
决策 4ce29c14 背书），让位期间 token 过期空窗。2026-08-10 三条 run（e674f58a / a94fff75 / 643b5302）
attempt 全部 384ms 死于 `Not logged in · Please run /login`。Codex（credential-envelope/v1）与容器
（docker-executor `:ro` + entrypoint 可写副本）已是「只读消费、单写入者」模式，本 sprint 补齐宿主 bridge 缺口。

## Golden Path（核心场景）

系统从 [bridge 收到 `/llm-call`（带 accountId）] → 经过 [为本 attempt 复制独立临时 config dir]
→ 到达 [claude 只写临时副本、权威文件零写入、attempt 结束临时副本被清理]

1. **触发**：bridge `/llm-call` 解析出 accountId（如 account1）。
2. **处理（核心变更）**：bridge 不再让 `CLAUDE_CONFIG_DIR` 指向权威 `~/.claude-account{N}`，
   改为按 attempt 创建**独立临时 config dir**（对齐 entrypoint.sh 从权威目录复制内容的做法），
   spawn claude 时 `CLAUDE_CONFIG_DIR` 指向该临时目录，claude 只读/只写临时副本。
3. **结果**：claude 退出后清理临时目录；权威 `.credentials.json` 的 mtime 与 sha256 全程不变，清理失败记日志不影响主流程。

## 边界情况

- 临时目录**创建失败** → 主流程应失败并告警（不得静默降级回权威目录起 claude）。
- 临时目录**清理失败** → 仅记日志，不影响 attempt 结果。
- **并发**：并行两个 bridge attempt，各自使用互不相同的临时目录，权威文件仍零写入。
- 无 accountId（默认账号路径）同样走临时副本，不得回退到直接使用 `~/.claude-account1`。

## 范围限定

**在范围内**：仅改宿主 bridge 的 Claude 凭据投递方式（`cecelia-bridge.cjs` 的 `/llm-call`
spawn 路径 L167-181）；临时 config dir 的创建/指向/清理三段生命周期 + 断言；交付物书面结论（见末段）。

**不在范围内**：
- 不改容器路径（docker-executor / entrypoint.sh）、不改 Codex 信封（credential-broker.js / credential-envelope.cjs）。
- **不改 `infrastructure` 仓库任何文件**（含 refresh-claude-tokens.sh，不在 WORKSPACE_REPOSITORIES 内）。
- 不改 gear 分档、不动 evaluator/judge/mergeGate；不做「自动切换未过期账号」（独立能力，本次不含）。
- 不在本 PR 内绕过/削弱让位逻辑（顺序颠倒会重新引入 invalid_grant 风险）。

## 假设

- [ASSUMPTION: 临时 config dir 用 `fs.mkdtemp` 系族在系统临时区创建，复制语义对齐 entrypoint.sh `cp -aL`；具体 API 由 proposer 定。]
- [ASSUMPTION: `cecelia-bridge.js`（379 行版本）若与 `.cjs` 同为 live 入口则同源改动，以部署实际拉起入口为准，proposer 核对后定改一个还是两个。]
- [ASSUMPTION: 第 2 步「收窄让位」仅为书面交付结论，本 sprint 不落任何代码修改。]

## 预期受影响文件

- `packages/brain/scripts/cecelia-bridge.cjs`：`/llm-call` spawn 路径（L167-181）由指向权威目录改为临时副本 + 清理。
- `packages/brain/scripts/cecelia-bridge.js`：如为 live 同源入口则同步改动（proposer 核对后定）。
- `packages/brain/scripts/__tests__/`（新增）：临时目录创建/清理单测 + 权威文件零写入集成/并发断言。

## NFR 约束

<!-- 来源: decisions 表 category=nfr 空；PrepPRD 显式约束优先 -->
- 超时/延迟：沿用现有 `/llm-call` timeout，本 sprint 不改。
- 权威文件写入：整个 attempt 生命周期内**只读、零写入**（核心红线，须 mtime+sha256 断言）。
- 可观测：临时目录创建失败必告警；清理失败必写日志。
- 零回归：容器路径与 Codex 信封路径既有单测全绿、行为不变。

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: 决策 4ce29c14（约束法源，thin_prd 直引）+ 本任务显式顺序铁律 + area 级 -->
- [单写入者] refresh_token 一次性轮换，两个无协调的刷新者迟早互相覆盖导致账号永久 invalid_grant；权威凭据文件必须只有一个写入者（来源: 决策 4ce29c14）
- [顺序不可颠倒] 必须先落地并验证第 1 步（宿主写入者归零），才允许收窄让位逻辑；颠倒即重新引入 invalid_grant 风险（来源: 本任务）
- [不碰让位] 本 PR 严禁绕过/削弱 refresh-claude-tokens.sh 让位逻辑，且不改 infrastructure 仓库任何文件（来源: 本任务）
- [证据分流] judge FAIL 先区分「证据窗口截断」与「实现缺陷」，evidence_insufficient 优先补证轮而非改代码（来源: area）

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: journey e6f803f2 已完成 ability 的 golden_path，按 ability 分组 -->
（本 line 暂无已验收 golden_path 历史——查得 ability 均为 planned 态，无 done/working）

## E2E 验收

> Planner 初稿此区块留占位 + 期望验收点自然语言描述；最终可执行脚本由 proposer 在 GAN 阶段按
> target_environment=local_api 填入（node 单测 + 本机集成 curl bridge `/llm-call`）。

```bash
# 占位：proposer 将按 target_environment=local_api 填入真实脚本（node --test + 本机起 bridge 发一次 /llm-call）
# 期望验收点（自然语言）：
# 1. 核心红线：记录 ~/.claude-account{N}/.credentials.json 的 mtime+sha256，经 bridge 跑完一次 attempt 后，
#    mtime 与 sha256 前后完全不变；任何变化即判失败。
# 2. 临时目录生命周期：attempt 中断言临时 config dir 被创建、claude 的 CLAUDE_CONFIG_DIR 指向该临时目录
#    （非权威目录）、attempt 结束后该目录被清理。
# 3. 单测：临时目录创建失败 → 主流程失败并告警；清理失败 → 仅记日志不影响结果。
# 4. 并发：并行两个 bridge attempt → 各自临时目录互不相同，权威文件仍零写入。
# 5. 零回归：docker-executor 与 credential-envelope 既有单测全绿。
```

## 交付物（第 2 步书面结论，供主理人修订决策 4ce29c14）

- 在 PR 描述/sprint 产出中写明：第 1 步落地后**宿主侧写入者已归零**，「让位」前提条件消失，
  可另行提案收窄 `SKIP:live_interactive_session_owns_refresh` 为「仅真人交互会话豁免」。
  本结论**仅记录、不在本 PR 内实施**。

## journey_type: agent_remote
## journey_type_reason: 改动落在宿主 bridge（cecelia-bridge）派发 claude 的远端 agent 协议路径，非 UI/engine/纯 brain 逻辑。
## target_environment: local_api
## target_environment_reason: bridge 与 ~/.claude-account{N} 权威文件均在本机（us-mac-m4），验收为 node 单测 + 本机起 bridge 发 /llm-call 并对 mtime/sha256 断言，由本地 evaluator 执行。
## journey_id: e6f803f2-8c48-4cce-a7a1-5b1bda5e9c29
## step_id: 3bf6c116
