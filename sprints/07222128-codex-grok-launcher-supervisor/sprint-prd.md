# Sprint PRD: Codex/Grok 有头 Launcher + 无头 Provider-Neutral Supervisor + 四路 Executor 路由修正

**Task ID**: f7ddad91-df1a-428c-9990-c4d02bedfcae
**Sprint Dir**: sprints/07222128-codex-grok-launcher-supervisor
**Generated**: 2026-07-22
**Status**: READY

---

## 1. 背景与根因

### 1.1 症状清单

| # | 症状 | 涉及文件 |
|---|------|----------|
| S1 | **Grok headed 路由错误**：`_spawnHeadedSession` 中 `innerCmd` 构造用 `isClaudeHeaded ? claude命令 : codex命令` 二元分支，导致 `executor=grok` 有头任务实际起 Codex | `packages/brain/src/harness-skill-relay.js` L917-920 |
| S2 | **Grok headless 路由错误**：`entrypoint.sh` 末段 `if CECELIA_EXECUTOR=codex … elif … else run_claude` 二元分支，`executor=grok` 的无头容器落入 `run_claude` | `docker/cecelia-runner/entrypoint.sh` ~L238-260 |
| S3 | **进程退出 ≠ 任务完成**：`dispatch-worker.mjs` 的 `buildCommand` 对 grok 用 `grok -p`（单轮非交互），对 codex 用 `codex exec`（同样单轮），CLI 进程 exit 0 被上层直接解读为"任务已完成"，缺少 `complete/continue/blocked` 状态协议 | `scripts/dispatch-worker.mjs` L24-38 |
| S4 | **Codex/Grok 有头进程无生命周期监督**：无 launcher 脚本记录 PID/session/退出码/信号，无崩溃恢复，无重启次数上限。Grok 已有两次真实 SIGABRT 崩溃报告（启动后 0.5-0.7 秒 abort） | `scripts/` 目录缺失 `grok-launch.sh` / `codex-launch.sh` |

### 1.2 根因分析

- **headed relay**：`_spawnHeadedSession`（harness-skill-relay.js L917-920）的 `innerCmd` 构造逻辑：
  ```js
  const innerCmd = isClaudeHeaded
    ? `... bash ${hostRepo}/scripts/claude-launch.sh ...`
    : `... CODEX_HOME=... codex ... "$(cat ${promptFile})"`;
  ```
  `isClaudeHeaded = headedExecutor === 'claude'`，`isGrokHeaded` 已定义但 `innerCmd` 未用，Grok 命中 else 分支，实际起 `codex` 命令。

- **headless Docker entrypoint**：`entrypoint.sh` 末段二元判断 `executor=codex` 走 codex 分支，否则 `run_claude`，Grok 静默降级成 Claude。`run_provider_contract`（HARNESS_ATTEMPT_ID 路径）已正确实现 claude/codex/grok 三分支，但旧路径（无 HARNESS_ATTEMPT_ID）只有二元判断。

- **dispatch-worker**：`buildCommand` 返回的 `grok -p` / `codex exec` 都是"这一轮回答结束即退出"的单次命令，调用方只检查 `exitCode` 判定完成，未建立任务完成确认协议。

- **Launcher 缺失**：`scripts/claude-launch.sh` 已实现 session 隔离、PID 记录、crash 感知的模式，但 Codex/Grok 无等价脚本。

---

## 2. Golden Paths（修复后必须成立）

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

### FR-R1：修正 `_spawnHeadedSession` Grok 路由
- **位置**：`packages/brain/src/harness-skill-relay.js` `_spawnHeadedSession` 函数，`innerCmd` 构造段
- **当前错误代码**（L917-920）：
  ```js
  const innerCmd = isClaudeHeaded
    ? `cd ${worktreePath} && ... bash ${hostRepo}/scripts/claude-launch.sh ...`
    : `cd ${worktreePath} && CODEX_HOME=... codex ... "$(cat ${promptFile})"`;
  ```
- **修正**：展开为三分支显式路由：
  - `isClaudeHeaded` → 原有 claude-launch.sh 命令（不变）
  - `isGrokHeaded` → `grok-launch.sh` 命令（新增）
  - else（codex）→ codex 命令（不变）
- **验收**：`innerCmd` 中不允许再出现 `isClaudeHeaded ? claudeCmd : codexCmd` 二元写法

### FR-R2：修正 `entrypoint.sh` Grok headless 路由
- **位置**：`docker/cecelia-runner/entrypoint.sh` 末段（约 L238-260）无 `HARNESS_ATTEMPT_ID` 的二元判断
- **当前错误代码**：
  ```bash
  if [[ "${CECELIA_EXECUTOR:-}" = "codex" ]]; then
    # B7: codex exec 分支
  else
    run_claude "$@"
  fi
  ```
- **修正**：改为三分支（`codex` / `grok` / `claude`），`grok` 分支调用 grok headless supervisor 或直接调 `grok -p`；未知 executor 显式 loud-fail（`echo "[entrypoint] ERROR: unsupported executor" >&2; exit 1`）
- **注意**：`HARNESS_ATTEMPT_ID` 已有的三分支路径（`run_provider_contract`）不需修改，只修无 `HARNESS_ATTEMPT_ID` 的旧路径

### FR-R3：新增 `scripts/codex-launch.sh`（headed launcher）
- 解析真实 codex 二进制路径（避免 alias 递归），支持 `CODEX_HOME` 覆盖
- 参数透传所有用户传入的 codex 参数
- 记录 PID、session ID、启动时间戳到 `/tmp/cecelia-codex-sessions/<session-id>.json`
- 捕获退出码和信号（trap SIGTERM/SIGABRT/SIGINT）
- 用户主动退出（Ctrl-C / `/exit` / `/quit` → exit 0 或 130）不重启
- SIGABRT / exit 143 / exit 137（非用户主动退出）最多重试 3 次，重试间隔指数退避（2s/4s/8s）
- 重试时用 `codex resume <session-id>` 恢复，首轮无 session-id 则新开
- 超过重试次数 → 记录失败到日志，写入 `HARNESS_TASK_ID` 对应的 Brain 任务失败状态，exit 1
- debug log 路径：`/tmp/cecelia-codex-sessions/<session-id>.debug.log`
- 幂等安装：`scripts/install-launchers.sh` 追加 alias 到 `~/.zshrc` 的受控 block（`# cecelia-launchers-begin` / `# cecelia-launchers-end`），不覆盖整个 `.zshrc`

### FR-R4：新增 `scripts/grok-launch.sh`（headed launcher）
- 解析真实 grok 二进制路径（`~/.grok/bin/grok` 优先，`which grok` fallback），避免 alias 递归
- 记录 PID、session ID、启动时间戳到 `/tmp/cecelia-grok-sessions/<session-id>.json`
- 捕获退出信号（SIGTERM/SIGABRT/SIGINT）
- 崩溃发生在 session 建立前（0.5-0.7s abort，SIGABRT，还未输出 session-id）：允许重开新 TUI，但受重试次数上限（≤3）约束
- 崩溃发生在 session 建立后：用 `grok --resume <session-id>` 恢复，同样 ≤3 次
- 超过重试次数 → 写回 Brain 失败状态，exit 1
- debug log：将 grok 的 stderr 和环境信息采集到 `/tmp/cecelia-grok-sessions/<session-id>.debug.log`
- 幂等安装（同 FR-R3）

### FR-R5：新增 Codex headless supervisor（`scripts/codex-supervisor.mjs` 或 `docker/cecelia-runner/codex-supervisor.sh`）
- 首轮：`codex exec --json --output-schema <schema> --output-last-message <result_file> -`
- 解析返回的结构化输出，确定状态：
  - `complete`：结合外部验收条件（检查 Brain task 的 phase/PR 状态）确认后标记完成
  - `continue`：用 `codex exec resume <session-id> --json ...` 续跑，携带同一 session-id
  - `blocked`：记录 blocked 原因，写回 Brain task 的 result 字段，不标记为成功，exit 0（让 watchdog 接管）
- 最大续跑次数：`MAX_TURNS` env（默认 10）
- 总 deadline：`SUPERVISOR_DEADLINE_SECONDS` env（默认 28800 = 8h）
- 超过次数或 deadline → 标 `timed_out`，写回 Brain，exit 1
- 每次续跑前更新 heartbeat（`/api/brain/harness/attempts/{id}/heartbeat`）

### FR-R6：新增 Grok headless supervisor（`scripts/grok-supervisor.mjs` 或 `docker/cecelia-runner/grok-supervisor.sh`）
- 首轮：`grok -p <task_bundle> --output-format json --json-schema <schema_file>`
- 解析结构化输出，`complete`/`continue`/`blocked` 三态
- `continue` 用 `grok -p <task_bundle> --resume <session-id> --output-format json` 续跑
- 其余逻辑（最大续跑次数、deadline、heartbeat、Brain 回写）对齐 FR-R5
- `complete` 同样需外部验收条件确认，不信模型自称

### FR-R7：四路路由测试覆盖（TDD RED→GREEN，先写 failing test）
- 路由回归测试必须以当前代码为基线，先证明错误行为（RED），再修复变绿（GREEN）
- 详见第 5 节验收标准

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

### 5.1 路由回归测试（`packages/brain/src/__tests__/harness-skill-relay.test.js`）

```
[RED→GREEN] Grok headed 路由
- test: executor=grok + mode=headed → innerCmd 调用 grok-launch.sh（不是 codex 命令）
- RED 条件：当前代码 innerCmd 包含 "codex"（可用 expect(innerCmd).toContain('grok') 为 RED）
- GREEN 条件：修复后 innerCmd 包含 grok-launch.sh 路径

[RED→GREEN] Grok headless entrypoint 路由
- test: CECELIA_EXECUTOR=grok + 无 HARNESS_ATTEMPT_ID → 调用 grok headless 路径（不是 run_claude）
- 测试文件：bash 集成测试（对齐 scripts/__tests__/cecelia-run-container-detect.test.sh 模式）

[RED→GREEN] 未知 executor loud-fail
- test: executor=unknown → ok=false + error 包含 "unsupported executor"（不是静默 spawn claude）

[回归] 现有 Claude/Codex headed/headless 路由全部通过（不回归）
```

### 5.2 Launcher 测试（fake binary 模拟）

```
[codex-launch.sh]
- 首轮成功（exit 0）：不重启，session-id 写入 JSON 文件
- 首轮成功但状态=continue：NOT APPLICABLE（launcher 不解析状态，supervisor 负责）
- SIGABRT（exit 134）：自动重启，尝试 codex resume <session-id>，≤3 次
- 用户 Ctrl-C（exit 130）：不触发重启，exit 130
- 超过 3 次重试：exit 1 + 写入失败日志
- CODEX_HOME 快照：launcher 使用临时快照目录，不直接用 CODEX_HOME（INV-11）

[grok-launch.sh]
- 首轮 exit 0（正常退出）：不重启
- SIGABRT（exit 134），session 建立前崩溃：重开新 TUI（不用 --resume），≤3 次
- SIGABRT，session 建立后崩溃：用 grok --resume <session-id>，≤3 次
- 超过 3 次：exit 1 + Brain 回写失败
- 用户 Ctrl-C：不重启
```

### 5.3 Supervisor 测试（`scripts/__tests__/`）

```
[codex-supervisor / grok-supervisor]
- 首轮 complete（fake binary exit 0 + JSON 含 status:complete）：
    外部验收检查通过 → 标任务完成
    外部验收检查失败（PR 未创建等）→ 标 needs_context，不伪装成功
- 首轮 continue（fake binary exit 0 + JSON 含 status:continue）：
    用同一 session-id 续跑下一轮（断言 --resume / resume 参数含相同 session-id）
- complete 后正确 exit 0，Brain 任务被标 completed
- blocked：Brain 任务被标 blocked + blocked_reason 字段有值，exit 0
- SIGABRT：supervisor 感知 binary 崩溃，触发 launcher 重试（通过 launcher 脚本）
- 用户 Ctrl-C（非 supervisor 内）：断言不触发无限循环
- 超过 MAX_TURNS：标 timed_out，exit 1
- 超过 SUPERVISOR_DEADLINE_SECONDS：标 timed_out，exit 1
```

### 5.4 DevGate（Brain 源码改动时）

```bash
node scripts/facts-check.mjs
bash scripts/check-version-sync.sh
node packages/quality/scripts/devgate/check-dod-mapping.cjs
```

若 `packages/brain/` 下有改动，同步更新 `packages/brain/DEFINITION.md` 版本号。

### 5.5 最终验收（真实运行）

- 真实跨过至少两个 Janitor cron 周期，逐条验证：
  1. Codex TUI 仍存活（没被 Janitor 杀）
  2. Grok TUI 正常退出与异常恢复可区分
  3. Codex headless 能跨 turn resume 到明确 complete
  4. Grok headless 能跨 turn resume 到明确 complete
  5. 真正的 node 孤儿进程仍会被清理
  6. 未知 executor 被路由层拦截并 loud-fail（不静默降级）

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

## 8. 实现顺序建议

```
Phase 1 (RED 测试先行):
  1a. 在 harness-skill-relay.test.js 写 Grok headed 路由 failing test（证明当前 bug）
  1b. 在 entrypoint 集成测试写 Grok headless 路由 failing test
  1c. 写未知 executor loud-fail 测试（同样 RED）

Phase 2 (路由修复→GREEN):
  2a. 修 _spawnHeadedSession innerCmd 三分支（FR-R1）
  2b. 修 entrypoint.sh 旧路径三分支（FR-R2）
  2c. 修 dispatch-worker.mjs 未知 executor loud-fail（FR-R8）

Phase 3 (新增 Launcher):
  3a. scripts/codex-launch.sh + 单元测试（FR-R3）
  3b. scripts/grok-launch.sh + 单元测试（FR-R4）
  3c. scripts/install-launchers.sh（幂等安装）

Phase 4 (新增 Supervisor):
  4a. scripts/codex-supervisor.mjs + fake binary 测试（FR-R5）
  4b. scripts/grok-supervisor.mjs + fake binary 测试（FR-R6）

Phase 5 (集成验收):
  5a. DevGate 通过（如有 Brain 改动）
  5b. 真实两个 Janitor 周期验收
```

---

## 9. 文件改动预期清单

| 文件 | 改动类型 | FR |
|------|----------|----|
| `packages/brain/src/harness-skill-relay.js` | 修改：`_spawnHeadedSession` innerCmd 三分支 | FR-R1 |
| `docker/cecelia-runner/entrypoint.sh` | 修改：末段旧路径三分支 + 未知 executor loud-fail | FR-R2 |
| `scripts/codex-launch.sh` | 新增 | FR-R3 |
| `scripts/grok-launch.sh` | 新增 | FR-R4 |
| `scripts/install-launchers.sh` | 新增 | FR-R3/R4 |
| `scripts/codex-supervisor.mjs` | 新增 | FR-R5 |
| `scripts/grok-supervisor.mjs` | 新增 | FR-R6 |
| `scripts/dispatch-worker.mjs` | 修改：未知 executor loud-fail | FR-R8 |
| `packages/brain/src/__tests__/harness-skill-relay.test.js` | 增加 Grok headed 路由测试 + 未知 executor 测试 | FR-R7 |
| `packages/brain/scripts/__tests__/` | 新增 entrypoint bash 集成测试 | FR-R7 |
| `packages/brain/DEFINITION.md` | 版本号更新（如有 brain 改动触发 DevGate） | DevGate |

---

## 附：关键代码定位

- **Bug S1 精确位置**：`packages/brain/src/harness-skill-relay.js` 约 L917-920（`innerCmd` 构造）
- **Bug S2 精确位置**：`docker/cecelia-runner/entrypoint.sh` 约 L238-260（末段 `if CECELIA_EXECUTOR=codex` 二元判断）
- **Bug S3 精确位置**：`scripts/dispatch-worker.mjs` L24-38（`buildCommand`）
- **参考实现**：`scripts/claude-launch.sh`（launcher 模式参考）；`docker/cecelia-runner/entrypoint.sh` `run_provider_contract` 函数（三分支 claude/codex/grok 已正确实现）

---

## journey_type: autonomous
## journey_type_reason: 纯 Brain/harness 后端路由修正 + launcher/supervisor 脚本，无用户可见 UI 交互
## target_environment: linux
## target_environment_reason: 测试运行在 CI Linux 容器（packages/brain/__tests__ + entrypoint.sh 集成测试）；headed launcher 验收需真机但非 E2E 路由范围
## journey_id: bdd411c0-ecbc-4b4a-b784-a8e65fd76396
## step_id: none（PrepPRD 未锚定）
