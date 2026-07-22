# Sprint PRD: Codex/Grok 有头 Launcher + 无头 Provider-Neutral Supervisor + 四路 Executor 路由修正

**Task ID**: f7ddad91-df1a-428c-9990-c4d02bedfcae
**Sprint Dir**: sprints/07222128-codex-grok-launcher-supervisor
**Generated**: 2026-07-22
**Status**: READY

---

## 1. 背景

三处二元路由 Bug 导致 Grok executor 被错误处理：`harness-skill-relay.js` `_spawnHeadedSession` 的 `innerCmd` 用 `isClaudeHeaded ? claude : codex` 二元分支（Grok headed 落入 Codex）；`entrypoint.sh` 旧路径用 `if executor=codex; else run_claude` 二元分支（Grok headless 落入 Claude）；`dispatch-worker.mjs` 用单次非交互命令（`grok -p`/`codex exec`）但把 CLI 进程退出直接当任务完成。此外，Codex/Grok 缺乏类似 `scripts/claude-launch.sh` 的 headed launcher，无崩溃恢复/重试上限机制（Grok 已有真实 SIGABRT 报告）。

---

## Golden Path（修复后必须成立）

| GP | 场景 | 期望行为 |
|----|------|----------|
| GP1 | `headed + claude` | Claude launcher（`claude-launch.sh`），现状不变，含 tmux，不回归 |
| GP2 | `headed + codex` | **新增** `scripts/codex-launch.sh`；`/exit`/`/quit`/Ctrl-C 不重启；SIGABRT/137/143 触发有限次重试（≤3）；用 `codex resume <session-id>` 恢复同一 session；debug log 采集崩溃现场 |
| GP3 | `headed + grok` | **新增** `scripts/grok-launch.sh`；用户主动退出不重启；SIGABRT（已实测启动 0.5-0.7s abort）触发有限次重试（≤3）；用 `grok --resume <session-id>` 或 `--continue` 恢复；launcher 打开 Grok debug log；崩溃发生在 session 建立前允许重开新 TUI 但受重试次数上限约束 |
| GP4 | `headless + claude` | 现有 Claude 路径（不变，不回归） |
| GP5 | `headless + codex` | **新增** Codex headless supervisor：`codex exec --json` 首轮 → 按 `complete`/`continue`/`blocked` 状态协议决策；`continue` 用 `codex exec resume <session-id>` 续跑；`complete` 需外部验收确认（不信模型自称）；`blocked` 写回 Brain 不伪装成功 |
| GP6 | `headless + grok` | **新增** Grok headless supervisor：`grok -p ... --output-format json` 首轮 → 同一 `complete`/`continue`/`blocked` 协议；`continue` 用 `grok -p ... --resume <session-id>` 续跑 |
| GP7 | 未知 executor | 四路路由显式 loud-fail（抛错/标记任务失败+写明原因），禁止静默兜底成任何已知 executor |
| GP8 | 任务完成判定 | "任务完成"必须结合 Brain/task/PR/phase 外部状态确认，不能只信模型自称 complete |

---

## 3. 功能需求（FR）

| FR | 描述 |
|----|------|
| FR-R1 | 修正 `harness-skill-relay.js` `_spawnHeadedSession` 的 `innerCmd`：从 `isClaudeHeaded ? claude : codex` 二元展开为三分支（claude→claude-launch.sh / grok→grok-launch.sh / codex→codex命令） |
| FR-R2 | 修正 `entrypoint.sh` 旧路径（无 `HARNESS_ATTEMPT_ID`）：`if executor=codex; else run_claude` 改为三分支（codex/grok/claude），未知 executor `exit 1 + 错误日志` |
| FR-R3 | 新增 `scripts/codex-launch.sh`：解析真实 codex 二进制、记录 PID/session-id/时间戳、trap SIGABRT/137/143 有限重试（≤3次）用 `codex resume` 恢复、exit 0/130 不重启、超限 exit 1、CODEX_HOME 用快照目录（INV-11）、debug log |
| FR-R4 | 新增 `scripts/grok-launch.sh`：同 FR-R3 语义，session 建立前崩溃重开新 TUI（受 ≤3 上限）、建立后用 `grok --resume <session-id>` 恢复、采集 grok stderr 到 debug log |
| FR-R5 | 新增 Codex headless supervisor（`scripts/codex-supervisor.mjs`）：首轮 `codex exec --json`，解析 `complete`/`continue`/`blocked` 三态；`continue` 用同一 session-id 续跑；`complete` 须外部验收；`blocked` 写回 Brain 不伪装成功；`MAX_TURNS`=10 / `SUPERVISOR_DEADLINE_SECONDS`=28800 超限标 `timed_out` |
| FR-R6 | 新增 Grok headless supervisor（`scripts/grok-supervisor.mjs`）：首轮 `grok -p ... --output-format json`，`continue` 用 `grok -p ... --resume <session-id>` 续跑，其余对齐 FR-R5 |
| FR-R7 | TDD RED→GREEN：路由回归测试先以现有代码证明 bug（RED），修复后断言正确分支（GREEN）；launcher/supervisor fake binary 测试（详见第 5 节） |
| FR-R8 | `scripts/install-launchers.sh`：幂等追加 alias 到 `~/.zshrc` 受控 block（`# cecelia-launchers-begin/end`），不覆盖其他内容 |

---

## 4. 不变量（Invariants）

| # | 不变量 | 作用范围 |
|---|--------|----------|
| INV-1 | 二元路由禁止：不允许 `if (isClaudeHeaded) { … } else { … codex命令 … }` 形态覆盖 claude+codex+grok 三种场景；必须显式三分支 | `harness-skill-relay.js` |
| INV-2 | 二元路由禁止：`entrypoint.sh` 旧路径不允许 `if executor=codex; else run_claude` 形态；未知 executor 必须 loud-fail（exit 1 + 错误日志） | `entrypoint.sh` |
| INV-3 | 用户主动退出不重启：exit 0 / exit 130（SIGINT 正常退出）不触发 launcher 重启逻辑 | `codex-launch.sh` / `grok-launch.sh` |
| INV-4 | 有限重试上限：SIGABRT/SIGTERM/137/143 导致的崩溃，launcher 最多重试 3 次（`MAX_RETRIES=3`），超限 exit 1 | `codex-launch.sh` / `grok-launch.sh` |
| INV-5 | Session 恢复优先：重试时必须优先用已知 session-id 恢复（`codex resume`/`grok --resume`），不开新 session（除非 session 建立前崩溃） | `codex-launch.sh` / `grok-launch.sh` |
| INV-6 | 完成确认外部化：`complete` 状态判定不能只信模型输出，必须结合 Brain/PR/phase 外部状态 | `codex-supervisor` / `grok-supervisor` |
| INV-7 | Blocked 不伪装成功：`blocked` 状态必须写回 Brain 并保留原因，不允许标 completed | `codex-supervisor` / `grok-supervisor` |
| INV-8 | 未知 executor loud-fail：路由层遇到 claude/codex/grok 以外的 executor 值，必须抛错或 exit 1 + 写明原因，禁止静默降级 | `harness-skill-relay.js` / `entrypoint.sh` / `dispatch-worker.mjs` |
| INV-9 | Launcher 幂等安装：`install-launchers.sh` 只追加/更新受控 alias block，不覆盖 `~/.zshrc` 其他内容 | `scripts/install-launchers.sh` |
| INV-10 | Grok 内部 abort 不修：Grok 是外部闭源二进制，launcher 只做检测、日志采集、有限重试；不尝试修复 Grok 内部崩溃逻辑 | `grok-launch.sh` |
| INV-11 | Codex 凭据快照：headed codex launcher 继承 `snapshotCodexRelayHome` 机制，不直接用真实 `CODEX_HOME`（防 cron 竞态） | `codex-launch.sh` |
| INV-12 | Janitor 兼容：Codex/Grok headed launcher 启动的进程必须符合 janitor 的"有 TTY 不得杀"判定（不得通过调高 threshold 绕过） | `codex-launch.sh` / `grok-launch.sh` |

**不变量总计：12**

---

## 5. 验收标准（TDD，RED→GREEN）

**路由回归（RED→GREEN）**：
- `executor=grok + mode=headed` → `innerCmd` 含 `grok-launch.sh`（不含 codex 命令）；先以现有代码证明 RED
- `CECELIA_EXECUTOR=grok` 无 `HARNESS_ATTEMPT_ID` → 调 grok 路径（不是 `run_claude`）；bash 集成测试
- `executor=unknown` → `ok=false + "unsupported executor"`（不静默 spawn）
- 现有 Claude/Codex 路由全部不回归

**Launcher（fake binary）**：exit 0/Ctrl-C 不重启；SIGABRT/134/137/143 最多重试 3 次并用同一 session-id 恢复；超限 exit 1；CODEX_HOME 使用快照目录（INV-11）

**Supervisor（fake binary）**：continue 用同一 session-id 续跑；complete 须通过外部验收（不信模型自称）；blocked 写回 Brain 不伪装成功；超 MAX_TURNS 或 deadline 标 timed_out exit 1

**DevGate**（brain 改动时）：`node scripts/facts-check.mjs && bash scripts/check-version-sync.sh && node packages/quality/scripts/devgate/check-dod-mapping.cjs`；同步更新 `packages/brain/DEFINITION.md` 版本号

**最终验收**：真实跨两个 Janitor 周期，确认 Codex/Grok TUI 存活与异常可区分、headless 能 resume 到 complete、孤儿进程仍被清理、未知 executor loud-fail

---

## 6. NFR（非功能性需求）

| 分类 | 要求 |
|------|------|
| 可观测性 | 每个 launcher/supervisor 启动和退出都写 structured log（含 task_id/session_id/pid/exit_code/signal） |
| 幂等性 | Launcher 安装脚本在同一机器重复执行不产生重复 alias，不覆盖用户 `.zshrc` 其他内容 |
| 超时 | Supervisor 总 deadline 默认 8h（`SUPERVISOR_DEADLINE_SECONDS=28800`），单轮最大时间跟随 Brain attempt heartbeat 超时（180s 无心跳 watchdog 接管） |
| 安全 | 不在 log 或环境变量中明文输出 `auth.json` token；凭据路径快照后以 0600 权限存 `/tmp/` 下临时目录 |
| 兼容性 | 现有 Claude headed/headless 路径零回归（双轨机制不动） |
| 环境隔离 | Launcher/supervisor 脚本不假设固定二进制路径，优先 `which`/env 变量，fallback 到已知路径候选列表 |

**NFR 段状态：完整（6 条）**

---

## 7. 边界（不在本任务范围）

- Janitor 孤儿判定逻辑修复（属于 zenithjoy-skills 仓库并行任务）——本任务只消费其修复结果做验收
- 修复 Grok 内部 SIGABRT 根因（外部闭源二进制，不可改）
- 新增 launcher 不得修改 Brain 核心调度逻辑（`dispatcher.js` / `tick.js`）
- 不引入新的 DB migration（supervisor 状态写入复用现有 Brain API `/api/brain/tasks/:id` PATCH）
- `dispatch-worker.mjs` 的 `buildCommand` 对 grok 的修复仅限于明确 loud-fail 未知 executor，任务完成状态协议由 supervisor 层负责，不在 `buildCommand` 内增加轮询逻辑

---

## journey_type: autonomous
## journey_type_reason: 纯 Brain/harness 后端路由修正 + launcher/supervisor 脚本，无用户可见 UI 交互
## target_environment: linux
## target_environment_reason: 测试运行在 CI Linux 容器（packages/brain/__tests__ + entrypoint.sh 集成测试）；headed launcher 验收需真机但非 E2E 路由范围
## journey_id: bdd411c0-ecbc-4b4a-b784-a8e65fd76396
## step_id: none（PrepPRD 未锚定）
