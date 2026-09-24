# kalloc 哨兵阈值重新标定 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 `check_kalloc_guard` 的三档阈值从 4/8/11G 下调到 3/5/7G，并把承载该守卫的 CI job 接进合并闸门。

**Architecture:** 纯参数改动——只改三个比较值与配套测试的注入值，动作、日志措辞、Brain 告警 payload、安全时段窗口一概不动。额外补一处闸门接线：`ops-tests-shell` job 一直在跑但不在 `ci-passed` 的 needs 里，红了拦不住合并，本次一并接上。

**Tech Stack:** bash（janitor.sh + shell 测试）、GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-24-kalloc-threshold-recalibrate-design.md`
**Brain task:** `30535584-801a-4965-8748-8f5dbca06b87` ｜ **decision:** `d71efe6b`

---

## 开工前必读：三条已核实的事实

**① `lint-tdd-commit-order` 管不到本次改动。** 它只扫 `^packages/brain/src/.*\.js$`
（`.github/workflows/scripts/lint-tdd-commit-order.sh:71`），`scripts/ops/` 不在覆盖内。
**仍然照 test-first 做**，那是纪律不是因为有闸。

**② 测试确实在 CI 跑。** `.github/workflows/ci.yml:515` 的 `ops-tests-shell` job 用
`find scripts/ops/__tests__ -name '*.test.sh'` 递归全收，且带防空转守卫（`found -eq 0` 即报错）。

**③ 但它不在 `ci-passed` 的 needs 里。** 47 项 needs 含 `brain-tests-shell` /
`runner-tests-shell` / `deploy-shell-tests`，**独缺 `ops-tests-shell`**。本地跑 11 个
ops 测试全绿（基线安全），Task 3 把它接上。

---

## 计划对 spec 的一处收紧

spec §6 写的注入值是 3.5G / 6G / 8G。本计划改用**边界精确值** 3G / 5G / 7G（即阈值本身），
理由：边界值同时验证「≥ 判据」的等号侧，且对旧阈值同样必红，是严格更强的测试。
另补一条 `3G-1KB` 验证边界下侧。spec 的意图（三条真红）不变。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `scripts/ops/__tests__/janitor/janitor_kalloc_guard.test.sh` | 逐档行为断言 | 改注入值 + 补边界用例 |
| `scripts/ops/janitor.sh` | `check_kalloc_guard` 三处比较值 | 改数字 |
| `.github/workflows/ci.yml` | `ci-passed` 的 needs | 补 `ops-tests-shell` |

---

## Task 1: 改测试注入值（commit-1，Red）

**Files:**
- Modify: `scripts/ops/__tests__/janitor/janitor_kalloc_guard.test.sh`

- [ ] **Step 1: 改 WARN 档注入值**

当前第 80-87 行：

```bash
# WARN 档：5GB，仅记日志，不调用 curl
KB_WARN=$((5*1024*1024))
OUT_WARN=$(run_guard "$KB_WARN")
if echo "$OUT_WARN" | grep -q '早期预警' && ! echo "$OUT_WARN" | grep -q 'MOCK_CURL'; then
  ok "WARN 档(5GB)仅记日志，未调用 Brain 告警"
else
  fail "WARN 档预期'早期预警'且无 curl 调用，实际输出: $OUT_WARN"
fi
```

整段替换为（注入值改成边界精确的 3GB，并在其前补一条边界下侧用例）：

```bash
# 边界下侧：3GB 差 1KB → 仍静默（验证 WARN 线的下边界）
KB_BELOW_WARN=$((3*1024*1024 - 1))
OUT_BELOW=$(run_guard "$KB_BELOW_WARN")
if ! echo "$OUT_BELOW" | grep -qE 'kalloc\.1024'; then
  ok "WARN 线下方(3GB-1KB)不触发任何 kalloc 日志"
else
  fail "WARN 线下方不应有 kalloc 日志，实际输出: $OUT_BELOW"
fi

# WARN 档：正好 3GB（边界等号侧），仅记日志，不调用 curl
KB_WARN=$((3*1024*1024))
OUT_WARN=$(run_guard "$KB_WARN")
if echo "$OUT_WARN" | grep -q '早期预警' && ! echo "$OUT_WARN" | grep -q 'MOCK_CURL'; then
  ok "WARN 档(3GB，边界等号侧)仅记日志，未调用 Brain 告警"
else
  fail "WARN 档预期'早期预警'且无 curl 调用，实际输出: $OUT_WARN"
fi
```

- [ ] **Step 2: 改 ALERT 档注入值**

当前第 89-95 行：

```bash
# ALERT 档：8.11GB，触发'偏高'日志 + 调用 curl
OUT_ALERT=$(run_guard 8500000)
if echo "$OUT_ALERT" | grep -q 'kalloc\.1024 偏高' && echo "$OUT_ALERT" | grep -q 'MOCK_CURL'; then
  ok "ALERT 档(8.11GB)触发'kalloc.1024 偏高'并调用 Brain 告警"
```

替换前三行为：

```bash
# ALERT 档：正好 5GB（边界等号侧），触发'偏高'日志 + 调用 curl
OUT_ALERT=$(run_guard $((5*1024*1024)))
if echo "$OUT_ALERT" | grep -q 'kalloc\.1024 偏高' && echo "$OUT_ALERT" | grep -q 'MOCK_CURL'; then
  ok "ALERT 档(5GB，边界等号侧)触发'kalloc.1024 偏高'并调用 Brain 告警"
```

（`else`/`fail` 两行不动。）

- [ ] **Step 3: 改三处 CRITICAL 注入值**

三处 `12000000` 全部换成 `$((7*1024*1024))`，**断言一字不动**：

第 97-105 行（非安全时段）：
```bash
OUT_CRIT_UNSAFE=$(run_guard 12000000 10)
```
→
```bash
OUT_CRIT_UNSAFE=$(run_guard $((7*1024*1024)) 10)
```

第 107-115 行（安全时段）：
```bash
OUT_CRIT_SAFE=$(run_guard 12000000 04)
```
→
```bash
OUT_CRIT_SAFE=$(run_guard $((7*1024*1024)) 04)
```

第 117-126 行（八进制炸弹回归）：
```bash
OUT_CRIT_OCTAL=$(run_guard 12000000 08 2>"$STDERR_08")
```
→
```bash
OUT_CRIT_OCTAL=$(run_guard $((7*1024*1024)) 08 2>"$STDERR_08")
```

同时把这两行的 `ok` 文案里的 `(11.44GB)` 改成 `(7GB)`：

```bash
  ok "CRITICAL 档(11.44GB)非安全时段(10点)仅告警，未触发重启"
  ok "CRITICAL 档(11.44GB)安全时段(4点)触发自动重启止损"
```
→
```bash
  ok "CRITICAL 档(7GB，边界等号侧)非安全时段(10点)仅告警，未触发重启"
  ok "CRITICAL 档(7GB，边界等号侧)安全时段(4点)触发自动重启止损"
```

**八进制回归用例的断言条件一个字不改**——它测的是前导零解析，与阈值无关。

- [ ] **Step 4: 跑测试，确认红，且确认红的是断言不是崩溃**

```bash
cd /Users/administrator/worktrees/cecelia/kalloc-threshold-recalibrate
bash scripts/ops/__tests__/janitor/janitor_kalloc_guard.test.sh; echo "exit=$?"
```

Expected: `exit=1`，输出里有 **5 条 `FAIL`**：

| 注入值 | 用在哪条断言 | 旧阈值(4/8/11)实际行为 | 期望 |
|---|---|---|---|
| 3G | WARN | 静默（3G < 4G） | 「早期预警」 |
| 5G | ALERT | 「早期预警」（≥4G, <8G） | 「偏高」 |
| 7G | CRITICAL 非安全时段 | 「早期预警」（≥4G, <8G） | 「危险…非安全时段仅告警」 |
| 7G | CRITICAL 安全时段 | 同上 | 「危险…自动重启止损」 |
| 7G | 八进制回归(hour=08) | 同上 | 「非安全时段仅告警」 |

> **为什么是 5 条不是 3 条**：7G 这个注入值被用在**三处**独立断言上（UNSAFE / SAFE /
> OCTAL），旧阈值下 7G < 8G 全落进 WARN 档，三条一起红。八进制回归那条红的是**档位**
> 不是前导零解析——它的 `stderr` 应为空，证明 `10#` 前缀仍工作正常；Task 2 改完阈值即转绿。

**必须是 `fail "..."` 打出来的断言失败，不是 bash 语法错/未绑定变量**。若看到
`unbound variable` / `syntax error`，说明改坏了，停下修到只剩断言红。

`3GB-1KB` 那条应 **PASS**（对新旧阈值行为一致）。

- [ ] **Step 5: commit-1**

```bash
cd /Users/administrator/worktrees/cecelia/kalloc-threshold-recalibrate
git add scripts/ops/__tests__/janitor/janitor_kalloc_guard.test.sh
git status --short
git -c user.name="Repo Lead" -c user.email="chalexlch@gmail.com" commit -F - <<'MSG'
fix(ops): kalloc 哨兵新阈值测试先行（Red）— 边界精确 3/5/7G

注入值改成边界等号侧（3G/5G/7G）并补一条 3GB-1KB 的下边界用例。
对着未改的 janitor.sh（4/8/11G）必红三条：3G 应 WARN 实际静默、
5G 应 ALERT 实际 WARN、7G 应 CRITICAL 实际 WARN。

八进制炸弹回归用例断言一字不动，只换注入值。

Brain task 30535584

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 2: 改阈值（commit-2，Green）

**Files:**
- Modify: `scripts/ops/janitor.sh`（`check_kalloc_guard` 内三处比较值）

- [ ] **Step 1: 改 CRITICAL 阈值**

```bash
    if [ "$kb" -ge $((11*1024*1024)) ] 2>/dev/null; then
```
→
```bash
    if [ "$kb" -ge $((7*1024*1024)) ] 2>/dev/null; then
```

- [ ] **Step 2: 改 ALERT 阈值**

```bash
    elif [ "$kb" -ge $((8*1024*1024)) ] 2>/dev/null; then
```
→
```bash
    elif [ "$kb" -ge $((5*1024*1024)) ] 2>/dev/null; then
```

- [ ] **Step 3: 改 WARN 阈值**

```bash
    elif [ "$kb" -ge $((4*1024*1024)) ] 2>/dev/null; then
```
→
```bash
    elif [ "$kb" -ge $((3*1024*1024)) ] 2>/dev/null; then
```

- [ ] **Step 4: 更新该函数上方的注释块**

当前注释里写着旧阈值：

```bash
  # 故做不到点名元凶，只能早发现早处理：WARN(4G仅日志)/ALERT(8G Brain告警)/
  # CRITICAL(11G，凌晨3-5点安全时段内自动重启止损)。用户拍板：复用 janitor 既有
```

替换为：

```bash
  # 故做不到点名元凶，只能早发现早处理：WARN(3G仅日志)/ALERT(5G Brain告警)/
  # CRITICAL(7G，凌晨3-5点安全时段内自动重启止损)。用户拍板：复用 janitor 既有
  # 2026-09-24 重新标定（决策 d71efe6b）：原 4/8/11G 是 9-18 事故时按当时内存余量
  # 定的；09-24 实测 kalloc 才 5.50G 未达 8G 告警线，机器已空闲 188M / swap 3977M /
  # load 5.3 / 自记「内存高压 99%」——余量被其余占用吃掉，告警线落在「快死了」而非
  # 「开始疼」。增长 +0.75G/天（/tmp/janitor-frequent.log 138 样本实测），
  # 自动重启节奏由约 14 天变约 9 天。
```

- [ ] **Step 5: 跑测试确认全绿**

```bash
cd /Users/administrator/worktrees/cecelia/kalloc-threshold-recalibrate
bash scripts/ops/__tests__/janitor/janitor_kalloc_guard.test.sh; echo "exit=$?"
```

Expected: `exit=0`，末行形如 `结果: PASS=N FAIL=0`。

- [ ] **Step 6: 跑全部 ops shell 测试，确认没打伤别的**

```bash
cd /Users/administrator/worktrees/cecelia/kalloc-threshold-recalibrate
found=0; fail=0
while IFS= read -r t; do
  found=$((found+1))
  bash "$t" >/dev/null 2>&1 || { fail=$((fail+1)); echo "❌ $t"; }
done < <(find scripts/ops/__tests__ -name '*.test.sh' -type f | sort)
echo "共 $found 个，失败 $fail 个"
```

Expected: `共 11 个，失败 0 个`（基线也是 11/0）。

- [ ] **Step 7: commit-2**

```bash
cd /Users/administrator/worktrees/cecelia/kalloc-threshold-recalibrate
git add scripts/ops/janitor.sh
git status --short
git -c user.name="Repo Lead" -c user.email="chalexlch@gmail.com" commit -F - <<'MSG'
fix(ops): kalloc 哨兵阈值 4/8/11G → 3/5/7G

原阈值是 2026-09-18 事故（kalloc 12.7GB、kernel_task 91% CPU 机器卡死）后按当时
内存余量定的。09-24 实测 kalloc 才 5.50G（未达 8G 告警线，按设计只记日志），但
机器已空闲 188M、swap 3977M/5120M、load 5.3、janitor 自记「内存高压 99%」——
其余占用（8 个 Claude 会话 2.84G + 11 tmux + 14 mosh + OrbStack VM）把余量吃掉了。

告警线落在「快死了」而非「开始疼」。增长 +0.75G/天（现有 138 样本实测），
自动重启节奏由约 14 天变约 9 天。动作、日志措辞、告警 payload、安全时段窗口一概不动。

合并当天当前 5.50G 会立即触发一次 Brain P1 告警——预期行为，非误报。

Brain task 30535584 / decision d71efe6b

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 3: 把 ops-tests-shell 接进合并闸门（commit-3）

> 本次改动的唯一守卫住在 `ops-tests-shell` job 里，而该 job 不在 `ci-passed` 的 needs
> 中——红了也拦不住合并。守卫必须被机器卡住，否则等于祈祷。

**Files:**
- Modify: `.github/workflows/ci.yml`（`ci-passed` 的 `needs` 与 check 清单）

- [ ] **Step 1: 确认基线安全（接闸前必做）**

```bash
cd /Users/administrator/worktrees/cecelia/kalloc-threshold-recalibrate
found=0; fail=0
while IFS= read -r t; do
  found=$((found+1)); bash "$t" >/dev/null 2>&1 || { fail=$((fail+1)); echo "❌ $t"; }
done < <(find scripts/ops/__tests__ -name '*.test.sh' -type f | sort)
echo "共 $found 个，失败 $fail 个"
```

Expected: `失败 0 个`。**若有任何失败，停下报告，不要接闸**——把一个红的 job 接进
必经闸门会挡死所有 PR。

- [ ] **Step 2: 在 needs 列表里补上**

用 grep 定位（行号会变，以实际输出为准）：

```bash
grep -n 'deploy-shell-tests\]' .github/workflows/ci.yml
```

把 needs 数组结尾的 `deploy-shell-tests]` 改成 `deploy-shell-tests, ops-tests-shell]`。

- [ ] **Step 3: 在 check 清单里补上**

`ci-passed` 的 steps 里有一串 `check "<job 名>" "${{ needs.<job>.result }}"`。
先看同族写法：

```bash
grep -n 'check "brain-tests-shell"\|check "runner-tests-shell"\|check "deploy-shell-tests"' .github/workflows/ci.yml
```

照同样格式，在 `check "deploy-shell-tests" ...` 那一行后面加一行：

```bash
          check "ops-tests-shell" "${{ needs.ops-tests-shell.result }}"
```

（缩进与相邻行对齐，用 grep 输出的实际缩进为准。）

- [ ] **Step 4: 校验 YAML 没改坏**

```bash
cd /Users/administrator/worktrees/cecelia/kalloc-threshold-recalibrate
python3 -c "
import yaml
d = yaml.safe_load(open('.github/workflows/ci.yml'))
needs = d['jobs']['ci-passed']['needs']
print('needs 项数:', len(needs))
print('含 ops-tests-shell:', 'ops-tests-shell' in needs)
print('ops-tests-shell job 存在:', 'ops-tests-shell' in d['jobs'])
"
```

Expected:
```
needs 项数: 48
含 ops-tests-shell: True
ops-tests-shell job 存在: True
```

若 `yaml` 模块缺失，先 `python3 -m pip install pyyaml --quiet`。

- [ ] **Step 5: 确认 check 行也加上了**

```bash
grep -c 'check "ops-tests-shell"' .github/workflows/ci.yml
```

Expected: `1`

- [ ] **Step 6: commit-3**

```bash
cd /Users/administrator/worktrees/cecelia/kalloc-threshold-recalibrate
git add .github/workflows/ci.yml
git status --short
git -c user.name="Repo Lead" -c user.email="chalexlch@gmail.com" commit -F - <<'MSG'
fix(ci): ops-tests-shell 接进 ci-passed — 跑了但拦不住合并的守卫

ops-tests-shell job（scripts/ops/__tests__ 下 11 个 shell 测试，含 kalloc 哨兵守卫）
一直在跑，但不在 ci-passed 的 needs 里——47 项 needs 含 brain-tests-shell /
runner-tests-shell / deploy-shell-tests，独缺它。红了 ci-passed 照样绿，而必需检查
只有 ci-passed / Harness V5 / Smoke Glob 三个，等于这批测试从来拦不住任何东西。

本 PR 的 kalloc 阈值守卫就住在这个 job 里。守卫必须被机器卡住，否则等于祈祷。

接闸前已确认基线安全：本地 11 个 ops 测试全绿。

Brain task 30535584

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
MSG
```

---

## Task 4: 变异测试（手工纪律，CI 无机械闸，不 commit 变异）

> 没见过它报红的守卫不算守卫。本仓 `.github/workflows/` 下无变异测试的机械闸，
> 这是写在 smoke 注释里的人工纪律（先例 `packages/brain/scripts/smoke/qiumi-dispatch-smoke.mjs:15`）。

- [ ] **Step 1: 变异 A —— 阈值整组改回 4/8/11**

把 `scripts/ops/janitor.sh` 的三处改回：

```bash
    if [ "$kb" -ge $((11*1024*1024)) ] 2>/dev/null; then
    elif [ "$kb" -ge $((8*1024*1024)) ] 2>/dev/null; then
    elif [ "$kb" -ge $((4*1024*1024)) ] 2>/dev/null; then
```

```bash
bash scripts/ops/__tests__/janitor/janitor_kalloc_guard.test.sh; echo "exit=$?"
```

Expected: `exit=1`，**3 条断言 FAIL**（不是语法错）。把实际失败信息记下来。

改回 3/5/7，重跑，确认 `exit=0`。

- [ ] **Step 2: 变异 B —— 只改 ALERT 一档（验证档与档之间没串）**

只把 ALERT 从 `5*1024*1024` 改成 `6*1024*1024`：

```bash
bash scripts/ops/__tests__/janitor/janitor_kalloc_guard.test.sh; echo "exit=$?"
```

Expected: `exit=1`，**只有 ALERT 那一条 FAIL**（5G 注入值落到 WARN 档 → 报
「早期预警」而非「偏高」）。WARN 与 CRITICAL 两档应仍 PASS——这证明三档是
各自独立钉住的，不是一条断言兜住全部。

改回 `5*1024*1024`，重跑确认 `exit=0`。

- [ ] **Step 3: 变异 C —— 验证闸门接线真的生效**

把 `.github/workflows/ci.yml` 里刚加的 `ops-tests-shell` 从 needs 数组临时删掉：

```bash
python3 -c "
import yaml
d = yaml.safe_load(open('.github/workflows/ci.yml'))
print('含 ops-tests-shell:', 'ops-tests-shell' in d['jobs']['ci-passed']['needs'])
"
```

Expected: `False`（证明这一行确实是承重的，不是装饰）。

改回去，重跑该校验确认 `True`。

- [ ] **Step 4: 确认工作区干净**

```bash
cd /Users/administrator/worktrees/cecelia/kalloc-threshold-recalibrate
git status --short
git diff HEAD --stat | wc -l
```

Expected: 两条都是空/0——三次变异全部改回，无残留。

---

## Task 5: 推送开 PR

- [ ] **Step 1: 确认 base 最新且工作区干净**

```bash
cd /Users/administrator/worktrees/cecelia/kalloc-threshold-recalibrate
git fetch -q origin main
echo "落后 origin/main: $(git rev-list --count HEAD..origin/main) 提交"
echo "未提交变更: $(git status --short | wc -l | tr -d ' ')"
echo "本分支 commit: $(git rev-list --count origin/main..HEAD)"
```

Expected: 落后 0、未提交 0、commit 数 4（spec + plan + 3 个 fix，其中 spec/plan 已先行提交）。
若落后不为 0，先 `git rebase origin/main` 并**检查退出码**（`$?` 为 0 才算完成，
只看有没有冲突目录会误判——本轮栽过一次）。

- [ ] **Step 2: 推送**

```bash
git push -u origin cp-0924082917-kalloc-threshold-recalibrate
```

- [ ] **Step 3: 开 PR**

标题（**前缀 `fix:`、不打 feature label**，否则触发 `lint-feature-has-smoke` 要求新增 smoke）：

```
fix(ops): kalloc 哨兵阈值 4/8/11G → 3/5/7G，并把 ops-tests-shell 接进合并闸门
```

---

## Self-Review 结果

**Spec 覆盖**：spec §3（三处阈值）→ Task 2 Step 1-3；§3 注释同步 → Task 2 Step 4；
§6 测试注入值 → Task 1；§6 变异测试 → Task 4 Step 1-2；§4 后果说明 → 写进 commit-2 message；
§5 上机链 → 无需动作（已核实自动 pull），写进 PR 描述。

**对 spec 的偏离（已声明）**：注入值由 3.5/6/8G 收紧为边界精确的 3/5/7G，理由见上方
「计划对 spec 的一处收紧」。三条真红的意图不变。

**新增于 spec 之外的 Task 3**：`ops-tests-shell` 未接闸是写计划阶段核实 CI 时发现的，
直接决定本次守卫有没有效力，故纳入。基线已验 11/11 绿，接闸安全。

**占位符**：无 TBD/TODO；每个改代码的 Step 都给了前后完整代码块。

**命名一致性**：`ops-tests-shell`（job 名）、`KB_WARN` / `KB_BELOW_WARN`（测试变量）、
`check_kalloc_guard`（函数名）三者在 Task 1/2/3/4 全文写法一致。
