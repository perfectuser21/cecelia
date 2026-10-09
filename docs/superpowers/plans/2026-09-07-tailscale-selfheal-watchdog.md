# Tailscale 自愈 watchdog + 计数器修复 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Tailscale 扩展卡死能在 4 分钟内自愈（而非人工重启），并根除 enforcer/login-watchdog 计数器跨事故残留。

**Architecture:** 三个独立 python 运维脚本（scripts/ops/）+ 各自 launchd 安装器 + vitest contract regression tests。全部复用仓库既有惯例：emit 单行 JSON / NamedTemporaryFile 原子写 / fcntl.flock 单实例 / tailscale_binary() 候选链 / plistlib 生成 plist。

**Tech Stack:** Python 3 (stdlib only), bash, launchd, vitest (tests/regression 既有模式)。

**设计文档：** docs/superpowers/specs/2026-09-07-tailscale-selfheal-watchdog-design.md（先读它）

## Global Constraints
- 所有输出/注释简体中文
- Python 只用 stdlib；脚本必须支持 --once 模式；所有路径经 env 可覆盖（CI mock 需要）
- TDD：每个逻辑改动先写 failing test（commit-1 test / commit-2 impl 可合并为单 commit 但顺序必须 test 先 fail）
- 参考真源：/private/tmp/claude-501/-Users-administrator/ebf189f7-648d-4e35-9ac6-4e169906b3fc/scratchpad/enforcer-deployed-xian-m4.py（xian-m4 部署版 enforcer，561 行）

---

### Task 1: 回填 enforcer 部署版（配置漂移归零）

**Files:**
- Modify: `scripts/ops/tailscale-us-exit-enforcer.py`（整体替换为部署版）
- Test: `tests/regression/tailscale-us-exit/tailscale-us-exit-enforcer.contract.test.js`（既有，跑通即可）

**Interfaces:**
- Produces: 部署版的 read_failure_count()/write_failure_count()/read_daemon_absent_count()/write_daemon_absent_count()（Task 2 修改它们）

- [ ] Step 1: `cp /private/tmp/claude-501/-Users-administrator/ebf189f7-648d-4e35-9ac6-4e169906b3fc/scratchpad/enforcer-deployed-xian-m4.py scripts/ops/tailscale-us-exit-enforcer.py`
- [ ] Step 2: `python3 -c "import ast; ast.parse(open('scripts/ops/tailscale-us-exit-enforcer.py').read())"` 语法通过
- [ ] Step 3: 跑既有 contract test：`npx vitest run tests/regression/tailscale-us-exit/ 2>&1 | tail -5`。若因新增计数器逻辑失败，按失败信息最小修正 test 的 fixture 期望（部署版行为是生产已验证的正确行为，test 跟着行为走）
- [ ] Step 4: Commit：`git add -A && git commit -m "fix(ops): 回填 xian-m4 部署版 enforcer 双阈值容错（9-03/9-04 热修），消除配置漂移"`

### Task 2: enforcer 计数器过期语义（修跨事故残留）

**Files:**
- Modify: `scripts/ops/tailscale-us-exit-enforcer.py`（read/write 计数函数）
- Test: `tests/regression/tailscale-us-exit/failure-counter-expiry.contract.test.js`（新建）

**Interfaces:**
- Produces: 计数文件 JSON 格式 `{"count": N, "last_failure_ts": epoch_float}`；`COUNTER_EXPIRY_SECONDS = 300`（env `CECELIA_US_EXIT_COUNTER_EXPIRY` 可覆盖）

- [ ] Step 1: 写 failing test（新建 failure-counter-expiry.contract.test.js，模式抄同目录既有 test：用 execFileSync 跑 `python3 -c` 调脚本内函数，或直接构造 count 文件跑 --once 观察 emit）。测试用例：
  1. count 文件写 `{"count": 50, "last_failure_ts": now-3600}` → 触发一次失败 → emit 的 consecutive_failures == 1（过期归零重计）
  2. count 文件写 `{"count": 2, "last_failure_ts": now-60}` → 触发失败 → consecutive_failures == 3（未过期递增）
  3. count 文件写裸整数 `50`（旧格式）→ 触发失败 → consecutive_failures == 1（旧格式按过期处理）
  4. 成功 tick → 两个 count 文件内容归零
  测试注入方式：env 覆盖 TAILSCALE_BIN 指向假脚本（exit 1 模拟 daemon_absent：stderr 输出 "Failed to connect to local Tailscale daemon"），STATE/COUNT/LOCK 文件全部指到临时目录。
- [ ] Step 2: 跑测试确认 fail（旧代码读裸整数会得 51）
- [ ] Step 3: 实现：read_failure_count/read_daemon_absent_count 改为读 JSON，`json.JSONDecodeError/ValueError` 或 `now - last_failure_ts > COUNTER_EXPIRY_SECONDS` → 返回 0；write_* 写 JSON 带 time.time()。写 0 时也写 JSON（保持格式统一）
- [ ] Step 4: 测试变绿；Task 1 的既有 contract test 仍绿
- [ ] Step 5: Commit：`git commit -m "fix(ops): enforcer 失败计数器带时间戳过期语义，根除跨事故残留（regression: 51 起跳 bug）"`

### Task 3: tailscale-health-watchdog.py 状态机

**Files:**
- Create: `scripts/ops/tailscale-health-watchdog.py`
- Test: `tests/regression/tailscale-health-watchdog/watchdog.contract.test.js`（新建，vitest.config.mjs 抄 tailscale-login-watchdog 目录）

**Interfaces:**
- Consumes: enforcer 的 tailscale_binary() 候选链 / emit() / persist 原子写 / flock 惯例（复制代码，两脚本独立部署不共享 import）
- Produces: state.json `{"fail_count":N,"restart_round":N,"last_restart_ts":epoch,"last_ok_ts":epoch}`；CLI `--once` `--check-client`；env 前缀 `CECELIA_TS_HEALTH_*`（STATE_FILE/LOCK_FILE/DISABLED_FILE/FAIL_THRESHOLD=3/COOLDOWN=600/MAX_ROUNDS=3/PROBE_TIMEOUT=15）

核心逻辑（run_once 伪码，实现必须照此）：
```
if DISABLED_FILE.exists(): emit("disabled"); return 0
status = probe()   # tailscale status --json, 15s 超时, 返回 dict 或 None
if status and status.get("BackendState") == "Running":
    state 全清零(fail_count=0, restart_round=0, last_ok_ts=now); emit("healthy"); return 0
state.fail_count += 1
if state.fail_count < FAIL_THRESHOLD: persist; emit("degraded", fail_count); return 1
# 达到阈值 → 自愈
if now - state.last_restart_ts < COOLDOWN: persist; emit("cooldown_wait"); return 1
if state.restart_round >= MAX_ROUNDS: persist; emit("stuck_gave_up"); return 2   # 只告警不再动手
state.restart_round += 1; state.last_restart_ts = now; state.fail_count = 0
if state.restart_round == 1: run(["/usr/bin/open","-gja","Tailscale"])            # 一级：唤醒 GUI
else: run(["/usr/bin/pkill","-f","io.tailscale.ipn.macsys.network-extension"])   # 二级+：强杀扩展，NE 自动重启
persist; emit("restart_attempted", round=restart_round, method=...); return 1
```

- [ ] Step 1: 写 failing test（contract test 用假 TAILSCALE_BIN 脚本控制 probe 结果，跑 `python3 scripts/ops/tailscale-health-watchdog.py --once`，断言 stdout JSON 与 state.json）。用例：健康清零 / 1-2 次失败只 degraded / 第 3 次失败触发 restart_attempted round=1 method=open / 冷却期内不再动 / 冷却过后第二轮 method=pkill / restart_round 达 3 后 stuck_gave_up / DISABLED 文件跳过
- [ ] Step 2: 跑测试 fail（文件不存在）
- [ ] Step 3: 实现脚本（结构/emit/原子写/flock/redact 全抄 login-watchdog.py，probe 抄 enforcer run_json；--check-client 校验 `tailscale status --json` 里 Self.HostName 属于 {mac-mini-m4-xian, mac-mini-m1-us} 白名单，env CECELIA_TS_HEALTH_ALLOWED_HOSTS 可覆盖）
- [ ] Step 4: 测试全绿
- [ ] Step 5: Commit：`git commit -m "feat(ops): 新增 tailscale-health-watchdog——扩展卡死 3 次探测失败自动分级自愈（open→pkill NE），带冷却与停手保护"`

### Task 4: 安装器 install-tailscale-health-watchdog.sh

**Files:**
- Create: `scripts/ops/install-tailscale-health-watchdog.sh`
- Test: 并入 Task 3 的 contract test 目录加 installer 用例（plutil -lint 生成的 plist；--system-* 参数覆盖到临时目录跑通不 sudo）

- [ ] Step 1: 复制 install-tailscale-us-exit-enforcer.sh 为模板改造：label `com.cecelia.tailscale-health-watchdog`，StartInterval=60，ProgramArguments `--once`，前置 `--check-client` 安全闸，ast.parse 语法预检（抄 login-watchdog 安装器），bootout 旧 label + bootstrap + kickstart。全部路径参数可覆盖。
- [ ] Step 2: installer 测试用例：`bash scripts/ops/install-tailscale-health-watchdog.sh --dry-run`（或参数覆盖模式）生成的 plist 通过 plutil -lint，含 StartInterval=60 与正确 label
- [ ] Step 3: Commit：`git commit -m "feat(ops): tailscale-health-watchdog launchd 安装器（复用 enforcer 安装模式）"`

### Task 5: login-watchdog 两处修复

**Files:**
- Modify: `scripts/ops/tailscale-login-watchdog.py`（424-433 分支；460 reauth 成功处）
- Modify: `scripts/ops/install-tailscale-login-watchdog.sh`（plist env 注入 CECELIA_LOGIN_WATCHDOG_ADVERTISE_EXIT=1）
- Test: `tests/regression/tailscale-login-watchdog/watchdog.contract.test.js`（追加用例）

- [ ] Step 1: 写 failing test 两个：
  1. state.json 预置 consecutive_failures=51 → 跑 --once 且 decide_action 走 restart_daemon（假 bin 让 status 返回 None）→ 断言 state.json consecutive_failures==0 且被 persist
  2. env CECELIA_LOGIN_WATCHDOG_ADVERTISE_EXIT=1 + reauth 成功路径（假 bin 依次返回 NeedsLogin status / up 成功 / status Running）→ 断言假 bin 收到过 `set --advertise-exit-node` 调用（假 bin 把 argv 追加写入日志文件供断言）
- [ ] Step 2: 跑测试 fail
- [ ] Step 3: 实现：424-433 分支改为 `if action in ("ok","disabled","restart_daemon"): state["consecutive_failures"]=0`，且四条路径统一 persist_state 后 return；reauth 成功清零处（460 后）加 advertise（env 开关，subprocess 30s 超时，失败 emit("advertise_exit_failed") 不改返回码）
- [ ] Step 4: 全部测试绿（含既有用例）
- [ ] Step 5: Commit：`git commit -m "fix(ops): login-watchdog restart_daemon/disabled 分支清零并持久化计数；reauth 成功后可选恢复 exit node 广播"`

### Task 6: CI 全绿 + push + PR

- [ ] Step 1: `npx vitest run tests/regression/ 2>&1 | tail -5` 全绿
- [ ] Step 2: push 分支，`gh pr create`，PR body 引用设计文档与 Brain task 4a2e418c，尾注按仓库规范
- [ ] （merge 后由主会话做）部署：xian-m4/xian-m1 装 health-watchdog + 更新 enforcer；perfect21 更新 login-watchdog 并注入 advertise env；真机 proven-to-fire 实测（kill Tailscale 看 ≤4min 自愈）
