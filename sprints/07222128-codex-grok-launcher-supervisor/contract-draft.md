# Contract Draft — Sprint: Codex/Grok 有头 Launcher + 无头 Provider-Neutral Supervisor + 四路 Executor 路由修正

**Task ID**: f7ddad91-df1a-428c-9990-c4d02bedfcae
**Sprint Dir**: sprints/07222128-codex-grok-launcher-supervisor
**Journey Type**: autonomous
**Target Environment**: linux

---

## Response Schema（推导来源: PRD 字面）

本 Sprint 无 HTTP 响应接口。涉及以下可验证产物：

| 产物 | 类型 | 验证方式 |
|------|------|----------|
| `packages/brain/src/harness-skill-relay.js` | 路由修正 | 源码静态断言（grep 三分支显式存在） |
| `docker/cecelia-runner/entrypoint.sh` | 路由修正 | bash 集成测试（旧路径三分支 + loud-fail） |
| `scripts/codex-launch.sh` | 新增 launcher | fake binary 单元测试（exit/信号/重试/会话恢复） |
| `scripts/grok-launch.sh` | 新增 launcher | fake binary 单元测试（exit/信号/重试/会话恢复） |
| `scripts/codex-supervisor.mjs` | 新增 supervisor | fake binary 单元测试（三态协议/外部验收/Brain 写回） |
| `scripts/grok-supervisor.mjs` | 新增 supervisor | fake binary 单元测试（三态协议/外部验收/Brain 写回） |
| `scripts/install-launchers.sh` | 幂等安装脚本 | 单元测试（受控 block 幂等追加） |

---

## 接缝清单（写断言前必答：这功能在哪几个点碰真实世界？）

| # | 接缝点 | 类型 | 真目标验证方式 |
|---|--------|------|----------------|
| 1 | `harness-skill-relay.js` `_spawnHeadedSession` 的 `innerCmd` 赋值 | 逻辑断言 | vitest/node 单元测试 — executor=grok 时 innerCmd 含 `grok-launch.sh` |
| 2 | `entrypoint.sh` 旧路径（无 `HARNESS_ATTEMPT_ID`）executor 分发 | bash 集成断言 | bash 测试 — `CECELIA_EXECUTOR=grok` 调 grok 路径，非 `run_claude` |
| 3 | `scripts/codex-launch.sh` 信号处理与重试逻辑 | 逻辑断言 | fake binary bash 测试 — SIGABRT/137/143 触发 ≤3 次重试后 exit 1 |
| 4 | `scripts/grok-launch.sh` 信号处理与重试逻辑 | 逻辑断言 | fake binary bash 测试 — 同上，用 `grok --resume` 恢复 |
| 5 | `scripts/codex-supervisor.mjs` 三态决策循环 | 逻辑断言 | vitest/node fake binary 测试 — continue 续跑、blocked 写 Brain、complete 外部验收 |
| 6 | `scripts/grok-supervisor.mjs` 三态决策循环 | 逻辑断言 | vitest/node fake binary 测试 — 对齐 codex-supervisor |
| 7 | 未知 executor loud-fail（harness-skill-relay.js + entrypoint.sh + dispatch-worker.mjs） | 逻辑断言 | 单元测试 — 返回 `ok=false` + 包含 "unsupported executor" 信息 |
| 8 | `install-launchers.sh` alias block 幂等性 | 逻辑断言 | bash 测试 — 重复运行不产生重复 alias |

逻辑断言（源码 + fake binary 单元测试）：vitest/bash 跑绿 = 逻辑 done
E2E 验收（真机跨 Janitor 周期）：Final E2E 章节描述 — 真机跑绿才 done

---

## 已知约束（来自回归测试）

- GP1（headed + claude）`innerCmd` 现有逻辑不得回归：`isClaudeHeaded` 为 true 时仍走 `claude-launch.sh`
- GP4（headless + claude）entrypoint.sh `run_claude` 路径不得回归
- `dispatch-worker.mjs` 现有 `codex exec --json` + `grok -p --output-format json` 调用不得修改（supervisor 层新增，不改 buildCommand 内轮询逻辑）
- `CODEX_RELAY_HOME` 凭据快照机制（INV-11）必须在 `codex-launch.sh` 中继承，不能直接用真实 `CODEX_HOME`

---

## Risks

| # | 风险 | 严重度 | Mitigation |
|---|------|--------|------------|
| 1 | `grok-launch.sh` 的 `--resume <session-id>` 参数在 Grok 二进制中未被支持（外部闭源，接口不确定） | High | BEHAVIOR 断言中区分"session 建立前崩溃 → 重开新 TUI"和"建立后 → `grok --resume`"；launcher 检测 session-id 是否已建立再决定 flag |
| 2 | `codex-supervisor.mjs` `complete` 外部验收依赖 Brain API 响应，Brain 宕机时逻辑错判 | High | BEHAVIOR 8 — Brain 不可达时走 blocked，不伪装 complete；测试用 fake Brain 验证 |
| 3 | `install-launchers.sh` 在 CI 容器（无 `~/.zshrc`）中执行行为 | Medium | 测试创建空 `~/.zshrc` 后验证追加，同时验证已有内容不被覆盖 |
| 4 | `entrypoint.sh` 三分支修正影响现有 `HARNESS_ATTEMPT_ID` 代码路径 | Medium | BEHAVIOR 11 确认：有 `HARNESS_ATTEMPT_ID` 时仍走 `run_provider_contract`，不受三分支影响 |

---

## Golden Path

```
[Brain 派发任务: executor=grok, mode=headed]
  → [harness-skill-relay.js _spawnHeadedSession]
  → [innerCmd 生成含 grok-launch.sh（三分支，不含 codex 命令）]
  → [SSH tmux 启动 grok-launch.sh]
  → [grok-launch.sh: SIGABRT → 有限重试 ≤3 次 → 用 grok --resume 恢复 session]
  → [任务完成后 grok-launch.sh exit 0]

[Brain 派发任务: executor=codex, mode=headless]
  → [entrypoint.sh 无 HARNESS_ATTEMPT_ID 路径]
  → [CECELIA_EXECUTOR=codex → 调 codex-supervisor.mjs]
  → [codex-supervisor.mjs: codex exec --json → 解析 continue/complete/blocked]
  → [continue → codex exec resume <session-id> 续跑]
  → [complete → Brain 外部验收确认]
  → [blocked → PATCH Brain /api/brain/tasks/:id 写 blocked 状态]

[executor=unknown]
  → [harness-skill-relay.js 返回 {ok: false, error: "unsupported executor: <value>"}]
  → [entrypoint.sh exit 1 + stderr 错误日志]
```

---

## Step 1: harness-skill-relay.js 三分支路由（GP2/GP3 核心 + INV-1）

**来源**: `[FROM_PRD]` — FR-R1 + INV-1 + FR-R7

**可观测行为**: `_spawnHeadedSession` 的 `innerCmd` 对 executor=grok 生成含 `grok-launch.sh` 的命令（当前 bug：落入二元 else 分支，生成 codex 命令）

**FR-R7 RED 阶段说明**（TDD RED→GREEN）：
RED 阶段验证当前代码存在 bug，不纳入 CI 正式断言。执行方式：generator 在修复前通过 `git stash` 将修复代码暂存，在原始有 bug 的代码上运行路由测试，确认 executor=grok 断言为 FAIL（证明 bug 存在），再 `git stash pop` 恢复修复代码。RED 阶段执行结果由 generator 注释在 PR 描述中。CI 中只保留 GREEN 断言（修复后的正确断言）。

**验证命令（逻辑断言）**:
```bash
node -e "
const src = require('fs').readFileSync('/workspace/packages/brain/src/harness-skill-relay.js', 'utf8');
// 确认三分支存在：claude / grok / codex 各有显式处理
const hasClauseBranch = /grok-launch\.sh/.test(src) && /codex-launch\.sh|CODEX_HOME.*codex/.test(src);
if (!hasClauseBranch) { console.error('FAIL: innerCmd 三分支缺失'); process.exit(1); }
// 确认禁止二元形式：isClaudeHeaded ? ... : codex
const hasBinaryBug = /isClaudeHeaded\s*\?\s*[^:]+:\s*\`[^]+codex [^]+\`/.test(src.slice(src.indexOf('_spawnHeadedSession')));
if (hasBinaryBug) { console.error('FAIL: 二元路由 bug 仍然存在'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 退出码 0，输出 OK

---

## Step 2: entrypoint.sh 旧路径三分支 + 未知 executor loud-fail（GP6/GP7 + INV-2）

**来源**: `[FROM_PRD]` — FR-R2 + INV-2

**可观测行为**: 无 `HARNESS_ATTEMPT_ID` 时，`CECELIA_EXECUTOR=grok` 进入 grok 分支；`CECELIA_EXECUTOR=unknown_xyz` exit 1 并输出明确错误

**验证命令（逻辑断言）**:
```bash
node -e "
const src = require('fs').readFileSync('/workspace/docker/cecelia-runner/entrypoint.sh', 'utf8');
// 旧路径必须有三分支（codex/grok/claude）
const hasGrokBranch = /CECELIA_EXECUTOR.*=.*grok/.test(src) || /provider.*==.*grok/.test(src);
if (!hasGrokBranch) { console.error('FAIL: entrypoint.sh 缺少 grok 分支'); process.exit(1); }
// 旧路径不能有 'if executor=codex; else run_claude' 二元形式（没有 grok 分支的旧写法）
// 检查 loud-fail 存在
const hasLoudFail = /exit 1/.test(src) && /unsupported executor|unknown executor|CECELIA_EXECUTOR.*invalid/.test(src);
if (!hasLoudFail) { console.error('FAIL: entrypoint.sh 缺少未知 executor loud-fail'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 退出码 0，输出 OK

---

## Step 3: scripts/codex-launch.sh 存在且含关键逻辑（GP2 + INV-3/4/5/11/12）

**来源**: `[FROM_PRD]` — FR-R3

**可观测行为**: `codex-launch.sh` 存在，含 MAX_RETRIES=3、trap SIGABRT、codex resume、CODEX_HOME 快照路径

**验证命令（逻辑断言）**:
```bash
node -e "
const src = require('fs').readFileSync('/workspace/scripts/codex-launch.sh', 'utf8');
const checks = [
  [/MAX_RETRIES.*3|MAX_RETRIES=3/, 'MAX_RETRIES=3 缺失'],
  [/trap.*SIGABRT|trap.*ABRT/, 'trap SIGABRT 缺失'],
  [/codex resume|codex.*resume/, 'codex resume 缺失'],
  [/CODEX_HOME.*snapshot|snapshot.*CODEX_HOME|codex-relay-cred/, '凭据快照 INV-11 缺失'],
  [/exit 0.*no.restart|exit 130|SIGINT/, 'exit 0/130 不重启逻辑缺失'],
];
let ok = true;
for (const [re, msg] of checks) {
  if (!re.test(src)) { console.error('FAIL:', msg); ok = false; }
}
if (ok) console.log('OK');
else process.exit(1);
"
```

**硬阈值**: 退出码 0，输出 OK

---

## Step 4: scripts/grok-launch.sh 存在且含关键逻辑（GP3 + INV-3/4/5/10/12）

**来源**: `[FROM_PRD]` — FR-R4

**可观测行为**: `grok-launch.sh` 存在，含 MAX_RETRIES=3、trap SIGABRT/ABRT/137/143、grok --resume、debug log 采集

**验证命令（逻辑断言）**:
```bash
node -e "
const src = require('fs').readFileSync('/workspace/scripts/grok-launch.sh', 'utf8');
const checks = [
  [/MAX_RETRIES.*3|MAX_RETRIES=3/, 'MAX_RETRIES=3 缺失'],
  [/trap.*SIGABRT|trap.*ABRT|trap.*134/, 'trap SIGABRT 缺失'],
  [/grok.*--resume|grok.*resume/, 'grok --resume 缺失'],
  [/debug.*log|LOG_FILE|stderr.*log/, 'debug log 采集缺失'],
  [/exit 0|exit 130|SIGINT/, 'exit 0/130 不重启逻辑缺失'],
];
let ok = true;
for (const [re, msg] of checks) {
  if (!re.test(src)) { console.error('FAIL:', msg); ok = false; }
}
if (ok) console.log('OK');
else process.exit(1);
"
```

**硬阈值**: 退出码 0，输出 OK

---

## Step 5: scripts/codex-supervisor.mjs 存在且含三态协议（GP5 + INV-6/7）

**来源**: `[FROM_PRD]` — FR-R5

**可观测行为**: `codex-supervisor.mjs` 存在，含 MAX_TURNS=10、SUPERVISOR_DEADLINE_SECONDS、complete/continue/blocked 三态解析、blocked 写 Brain、continue 用 session-id 续跑

**验证命令（逻辑断言）**:
```bash
node -e "
const src = require('fs').readFileSync('/workspace/scripts/codex-supervisor.mjs', 'utf8');
const checks = [
  [/MAX_TURNS.*10|MAX_TURNS=10/, 'MAX_TURNS=10 缺失'],
  [/SUPERVISOR_DEADLINE_SECONDS.*28800|28800/, 'SUPERVISOR_DEADLINE_SECONDS=28800 缺失'],
  [/complete.*continue.*blocked|blocked.*complete/, '三态协议缺失'],
  [/resume.*session.id|session.id.*resume/, 'continue resume session-id 缺失'],
  [/PATCH.*tasks|brain.*tasks.*blocked/, 'blocked 写 Brain 缺失'],
  [/timed_out|timeout.*exit 1/, 'timed_out 超限处理缺失'],
];
let ok = true;
for (const [re, msg] of checks) {
  if (!re.test(src)) { console.error('FAIL:', msg); ok = false; }
}
if (ok) console.log('OK');
else process.exit(1);
"
```

**硬阈值**: 退出码 0，输出 OK

---

## Step 6: scripts/grok-supervisor.mjs 存在且含三态协议（GP6 + INV-6/7）

**来源**: `[FROM_PRD]` — FR-R6

**可观测行为**: `grok-supervisor.mjs` 存在，对齐 codex-supervisor 三态协议，continue 用 `grok -p ... --resume <session-id>` 续跑

**验证命令（逻辑断言）**:
```bash
node -e "
const src = require('fs').readFileSync('/workspace/scripts/grok-supervisor.mjs', 'utf8');
const checks = [
  [/MAX_TURNS.*10|MAX_TURNS=10/, 'MAX_TURNS=10 缺失'],
  [/SUPERVISOR_DEADLINE_SECONDS.*28800|28800/, 'SUPERVISOR_DEADLINE_SECONDS=28800 缺失'],
  [/grok.*-p.*--resume|--resume.*session/, 'grok -p --resume session-id 缺失'],
  [/blocked.*brain|PATCH.*tasks/, 'blocked 写 Brain 缺失'],
  [/timed_out|timeout.*exit 1/, 'timed_out 超限处理缺失'],
];
let ok = true;
for (const [re, msg] of checks) {
  if (!re.test(src)) { console.error('FAIL:', msg); ok = false; }
}
if (ok) console.log('OK');
else process.exit(1);
"
```

**硬阈值**: 退出码 0，输出 OK

---

## Step 7: dispatch-worker.mjs 未知 executor loud-fail（INV-8 + GP7）

**来源**: `[FROM_PRD]` — INV-8

**可观测行为**: `buildCommand` 遇到未知 vendor 时抛 `Error('unknown vendor: ...')`（现有已有此逻辑，确认不回归）

**验证命令（逻辑断言）**:
```bash
node -e "
const src = require('fs').readFileSync('/workspace/scripts/dispatch-worker.mjs', 'utf8');
if (!src.includes('unknown vendor')) { console.error('FAIL: dispatch-worker.mjs 缺少 unknown vendor 错误'); process.exit(1); }
console.log('OK');
"
```

**硬阈值**: 退出码 0，输出 OK

---

## Step 8: install-launchers.sh 幂等 alias 追加（INV-9）

**来源**: `[FROM_PRD]` — FR-R8

**可观测行为**: `install-launchers.sh` 存在，追加受控 alias block（`# cecelia-launchers-begin/end`），重复运行不产生重复 alias

**验证命令（逻辑断言）**:
```bash
node -e "
const src = require('fs').readFileSync('/workspace/scripts/install-launchers.sh', 'utf8');
const checks = [
  [/cecelia-launchers-begin|launchers-begin/, '受控 block begin 标记缺失'],
  [/cecelia-launchers-end|launchers-end/, '受控 block end 标记缺失'],
  [/codex-launch\.sh/, 'codex-launch.sh alias 缺失'],
  [/grok-launch\.sh/, 'grok-launch.sh alias 缺失'],
];
let ok = true;
for (const [re, msg] of checks) {
  if (!re.test(src)) { console.error('FAIL:', msg); ok = false; }
}
if (ok) console.log('OK');
else process.exit(1);
"
```

**硬阈值**: 退出码 0，输出 OK

---

## E2E 验收（autonomous journey，linux 环境，Final E2E 跑）

**说明**: `journey_type=autonomous`，无用户可见 UI，Final E2E 须在 CI Linux 容器内真实执行，或真机跨两个 Janitor 周期。

### E2E-1: 路由回归（RED→GREEN 单元测试，CI 绿）

**期望**: 所有路由单元测试（`scripts/__tests__/codex-grok-launcher-routing.test.sh` + `packages/brain/__tests__/harness-skill-relay-routing.test.js`）在 CI linux-latest runner 上跑绿

**验证命令**:
```bash
# 路由单元测试
bash /workspace/scripts/__tests__/codex-grok-launcher-routing.test.sh
# Brain relay 路由单元测试
node --experimental-vm-modules /workspace/packages/brain/__tests__/harness-skill-relay-routing.test.js
```

**硬阈值**: 全部 PASS，0 FAIL

---

### E2E-2: Launcher fake binary 测试（CI 绿）

**期望**: `scripts/__tests__/codex-launch.test.sh` + `scripts/__tests__/grok-launch.test.sh` 通过 fake binary 验证 exit 0 不重启、SIGABRT/137 重试 ≤3 次、超限 exit 1、session-id 恢复

**验证命令**:
```bash
bash /workspace/scripts/__tests__/codex-launch.test.sh
bash /workspace/scripts/__tests__/grok-launch.test.sh
```

**硬阈值**: 全部 PASS，0 FAIL

---

### E2E-3: Supervisor 静态源码断言（CI 绿）

**说明**：本测试为**静态分析，非运行时验证**。`codex-supervisor.test.mjs` / `grok-supervisor.test.mjs` 通过 grep/正则对源码结构进行断言（三态协议字符串、Brain PATCH 逻辑、MAX_TURNS/DEADLINE 常量、session-id resume 逻辑）。不启动 fake binary 或 fake Brain HTTP server。运行时行为（continue 续跑、blocked 写 Brain、complete 外部验收）通过 RED 阶段 `git stash` 前后对比由 generator 手动执行，结果注释在 PR 描述中。

**期望**: `codex-supervisor.test.mjs` + `grok-supervisor.test.mjs` 源码结构断言全部 PASS

**验证命令**:
```bash
node /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/codex-supervisor.test.mjs
node /workspace/sprints/07222128-codex-grok-launcher-supervisor/tests/grok-supervisor.test.mjs
```

**硬阈值**: 全部 PASS，0 FAIL

---

### E2E-4: entrypoint.sh bash 集成测试（CI 绿）

**期望**: `scripts/__tests__/codex-grok-entrypoint-routing.test.sh` 验证 grok 路径、unknown loud-fail、codex 路径不回归、claude 路径不回归

**验证命令**:
```bash
bash /workspace/scripts/__tests__/codex-grok-entrypoint-routing.test.sh
```

**硬阈值**: 全部 PASS，0 FAIL

---

### E2E-5: install-launchers.sh 幂等测试（CI 绿）

**期望**: `scripts/__tests__/install-launchers.test.sh` 验证幂等追加、不覆盖现有内容

**验证命令**:
```bash
bash /workspace/scripts/__tests__/install-launchers.test.sh
```

**硬阈值**: 全部 PASS，0 FAIL

---

## 不变量快速查核

| INV | 可验证断言 | 测试文件 |
|-----|-----------|---------|
| INV-1 | `_spawnHeadedSession` innerCmd 无二元 `isClaudeHeaded ? : codex` 形态 | `harness-skill-relay-routing.test.js` |
| INV-2 | `entrypoint.sh` 旧路径有三分支，未知 executor exit 1 + 错误信息 | `codex-grok-entrypoint-routing.test.sh` |
| INV-3 | launcher exit 0/130 不重启 | `codex-launch.test.sh`, `grok-launch.test.sh` |
| INV-4 | launcher SIGABRT/137/143 最多重试 3 次，超限 exit 1 | `codex-launch.test.sh`, `grok-launch.test.sh` |
| INV-5 | 重试时用已知 session-id 恢复 | `codex-launch.test.sh`, `grok-launch.test.sh` |
| INV-6 | complete 不信模型自称，须外部验收 | `codex-supervisor.test.mjs`, `grok-supervisor.test.mjs` |
| INV-7 | blocked 写 Brain 不标 completed | `codex-supervisor.test.mjs`, `grok-supervisor.test.mjs` |
| INV-8 | 未知 executor loud-fail（三处文件）| `codex-grok-launcher-routing.test.sh`, `codex-grok-entrypoint-routing.test.sh` |
| INV-9 | install-launchers.sh 幂等 | `install-launchers.test.sh` |
| INV-10 | grok-launch.sh 源码不含 patch/sed.*grok/awk.*grok 等修改 Grok 内部逻辑的操作 | DoD BEHAVIOR grep -v 静态断言 |
| INV-11 | codex-launch.sh 用凭据快照目录，非真实 CODEX_HOME | `codex-launch.test.sh` |
| INV-12 | codex-launch.sh 和 grok-launch.sh 不含 --no-tty 或强制去 TTY 的标志 | DoD BEHAVIOR grep 静态断言 |
