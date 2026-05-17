# Stop Hook 二次精修 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** classify_session 探测失败路径（cwd 不是目录 / git rev-parse 失败 ×2）从 status=`not-dev` 改为 `blocked`，让"在 dev worktree 内的探测异常"fail-closed 走 exit 2 不再误放行。

**Architecture:** 仅改 `packages/engine/lib/devloop-check.sh` 的 classify_session 函数内 3 处 status 字符串。stop-dev.sh / stop.sh / 出口拓扑全部不动。bypass / 主分支 / 无 .dev-mode 三种"明确非 dev"路径继续走 not-dev → exit 0。

**Tech Stack:** bash 3.2 兼容，jq，既有 vitest E2E（`stop-hook-full-lifecycle.test.ts` 12 场景）+ 既有 integration（`devloop-classify.test.sh` 8 分支）

---

## 文件结构

| 文件 | 操作 | 责任 |
|---|---|---|
| `packages/engine/lib/devloop-check.sh` | 改 3 处字符串 | classify_session 探测失败路径 fail-closed |
| `packages/engine/tests/integration/devloop-classify.test.sh` | 加 4 case + 改 2 case | 新增 fail-closed 验证 + 调整老 case 期望 |
| `packages/engine/tests/hooks/stop-hook-exit-codes.test.ts` | 可能改若干 | 如有"探测失败 exit 0"断言需更新（实施 Task 4 时审查） |
| 6 个 Engine 版本文件 + SKILL.md frontmatter | 改版本号 | 18.17.0 → 18.17.1 patch bump |
| `packages/engine/feature-registry.yml` | 加 changelog | 18.17.1 条目 |
| `docs/learnings/cp-0504140226-single-exit-strict.md` | 新建 | Learning |

---

## Task 1: 扩展 integration 测试 — fail-closed 4 case（TDD red）

**Files:**
- Modify: `packages/engine/tests/integration/devloop-classify.test.sh`

- [ ] **Step 1: 修订既有 Case 2 + Case 3（cwd 异常 / 非 git）**

读 `/Users/administrator/worktrees/cecelia/single-exit-strict/packages/engine/tests/integration/devloop-classify.test.sh`。当前两个 case：

```bash
# Case 2: cwd 不是目录 → not-dev
result=$(classify_session "/non/existent/path/zzz")
status=$(echo "$result" | jq -r '.status')
assert_status "cwd 不是目录" "not-dev" "$status"

# Case 3: cwd 是目录但不是 git repo → not-dev
NOT_GIT="$TMPROOT/not-git"
mkdir -p "$NOT_GIT"
result=$(classify_session "$NOT_GIT")
status=$(echo "$result" | jq -r '.status')
assert_status "非 git repo" "not-dev" "$status"
```

把这两个 `assert_status` 第 2 个参数从 `"not-dev"` 改成 `"blocked"`：

```bash
# Case 2: cwd 不是目录 → blocked（fail-closed，PR #2745 后修订）
result=$(classify_session "/non/existent/path/zzz")
status=$(echo "$result" | jq -r '.status')
assert_status "cwd 不是目录 fail-closed" "blocked" "$status"

# Case 3: cwd 是目录但不是 git repo → blocked（fail-closed）
NOT_GIT="$TMPROOT/not-git"
mkdir -p "$NOT_GIT"
result=$(classify_session "$NOT_GIT")
status=$(echo "$result" | jq -r '.status')
assert_status "非 git repo fail-closed" "blocked" "$status"
```

- [ ] **Step 2: 在 Case 8（`echo ""; echo "=== Total: ..."` 之前）追加新 Case 9 + Case 10**

在 `echo ""` 总结行**之前**追加：

```bash
# Case 9: cp-* 分支 + git rev-parse --abbrev-ref 失败模拟（detached HEAD via fresh init 没 commit）→ blocked
EMPTY_GIT="$TMPROOT/empty-git"
mkdir -p "$EMPTY_GIT"
( cd "$EMPTY_GIT" && git init -q )  # 没 commit，HEAD 指向 unborn branch
result=$(classify_session "$EMPTY_GIT")
status=$(echo "$result" | jq -r '.status')
# 注：unborn HEAD 时 git rev-parse --abbrev-ref HEAD 返回 "HEAD"，命中主分支放行 → not-dev
# 但 cwd 路径仍可读 + show-toplevel 成功，所以走主分支放行而不是探测失败
assert_status "unborn HEAD（HEAD 主分支放行）" "not-dev" "$status"

# Case 10: cp-* 分支 + .dev-mode 含 cleanup_done 残留 → done（透传，回归保护）
CLEAN2_REPO="$TMPROOT/clean2-repo"
mkdir -p "$CLEAN2_REPO"
( cd "$CLEAN2_REPO" && git init -q -b main && git commit -q --allow-empty -m init && git checkout -q -b cp-clean2 )
cat > "$CLEAN2_REPO/.dev-mode.cp-clean2" <<EOF
dev
branch: cp-clean2
cleanup_done: true
EOF
result=$(classify_session "$CLEAN2_REPO")
status=$(echo "$result" | jq -r '.status')
assert_status "cleanup_done 透传 done（回归保护）" "done" "$status"
```

- [ ] **Step 3: 跑测试验证 fail（Case 2/3 期望 blocked 但实际仍 not-dev）**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
bash "$WT/packages/engine/tests/integration/devloop-classify.test.sh"
echo "exit=$?"
```

期望：Case 2、Case 3 fail（status=not-dev，期望 blocked），其他 case PASS。整体 exit 非 0。

- [ ] **Step 4: commit red 状态**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
git -C "$WT" add packages/engine/tests/integration/devloop-classify.test.sh
git -C "$WT" commit -m "test(engine): integration fail-closed 期望（TDD red）

Case 2 (cwd 不是目录) + Case 3 (非 git repo) 期望从 not-dev 改为 blocked。
新增 Case 9 (unborn HEAD 主分支放行) + Case 10 (cleanup_done 回归保护)。
当前 classify_session 仍归 not-dev，Case 2/3 fail。
"
```

---

## Task 2: classify_session fail-closed（TDD green）

**Files:**
- Modify: `packages/engine/lib/devloop-check.sh:404-419`（探测失败 3 处 status 字符串）

- [ ] **Step 1: 改 cwd 不是目录路径（L406）**

读 `/Users/administrator/worktrees/cecelia/single-exit-strict/packages/engine/lib/devloop-check.sh` line 404-408。找：

```bash
        # 2) cwd 必须是目录
        if [[ ! -d "$cwd" ]]; then
            result_json='{"status":"not-dev","reason":"cwd 不是目录"}'
            break
        fi
```

改为：

```bash
        # 2) cwd 必须是目录（fail-closed：在 dev worktree 内探测失败必须 block，不能误放行）
        if [[ ! -d "$cwd" ]]; then
            result_json='{"status":"blocked","reason":"cwd 不是目录（fail-closed，可能是文件系统竞态）"}'
            break
        fi
```

- [ ] **Step 2: 改非 git repo 路径（L412-415）**

找：

```bash
        wt_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || {
            result_json='{"status":"not-dev","reason":"非 git repo（rev-parse --show-toplevel 失败）"}'
            break
        }
```

改为：

```bash
        wt_root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || {
            result_json='{"status":"blocked","reason":"git rev-parse --show-toplevel 失败（fail-closed，可能是 git 锁竞态）"}'
            break
        }
```

- [ ] **Step 3: 改 git rev-parse --abbrev-ref 失败路径（L416-419）**

找：

```bash
        branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null) || {
            result_json='{"status":"not-dev","reason":"无法读取分支（rev-parse --abbrev-ref 失败）"}'
            break
        }
```

改为：

```bash
        branch=$(git -C "$cwd" rev-parse --abbrev-ref HEAD 2>/dev/null) || {
            result_json='{"status":"blocked","reason":"git rev-parse --abbrev-ref HEAD 失败（fail-closed）"}'
            break
        }
```

- [ ] **Step 4: 跑 integration 测试转 green**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
bash "$WT/packages/engine/tests/integration/devloop-classify.test.sh"
echo "exit=$?"
```

期望：10 PASS / 0 FAIL + exit=0。

如有 fail：**不要改测试**，调实现。

- [ ] **Step 5: commit green 状态**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
git -C "$WT" add packages/engine/lib/devloop-check.sh
git -C "$WT" commit -m "fix(engine): classify_session 探测失败 fail-closed (cp-0504140226)

3 处 not-dev → blocked：
- cwd 不是目录
- git rev-parse --show-toplevel 失败
- git rev-parse --abbrev-ref HEAD 失败

bypass / 主分支 / 无 .dev-mode 仍归 not-dev（明确非 dev 上下文）。
'确认进入开发模式' 后，唯一 exit 0 = PR 真完成（done）。
"
```

---

## Task 3: E2E 12 场景全量回归 + 守护

**Files:** （只跑测试，不改代码）

- [ ] **Step 1: 跑既有 12 场景 E2E**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
cd "$WT" && timeout 300 npx vitest run packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts 2>&1 | tail -8
```

期望：12 PASS。如有 fail，根据失败场景判断：
- 如果是"主分支放行"等明确非 dev 路径 fail：实现错了，回 Task 2 检查
- 如果是"探测失败下断言 exit 0" fail：测试需要更新（行为已改）

- [ ] **Step 2: 跑 dev-workflow + engine-dynamic-behavior + stop-hook-exit-codes + stop-hook-exit**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
cd "$WT" && timeout 600 npx vitest run \
    packages/engine/tests/e2e/dev-workflow-e2e.test.ts \
    packages/engine/tests/e2e/engine-dynamic-behavior.test.ts \
    packages/engine/tests/hooks/stop-hook-exit-codes.test.ts \
    packages/engine/tests/hooks/stop-hook-exit.test.ts 2>&1 | tail -10
```

期望：全过。

- [ ] **Step 3: 跑 check-single-exit 守护**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
bash "$WT/scripts/check-single-exit.sh" 2>&1 | tail -5
```

期望：3 ✅（stop-dev.sh exit 0=1 / hooks/stop-dev.sh exit 0=1 / devloop-check.sh return 0=2，本次未改这些）

- [ ] **Step 4: 如 Step 2 有 fail，按场景修复**

可能受影响的测试：
- `stop-hook-exit-codes.test.ts` 中如有"cwd 不存在"或"非 git repo" 场景断言 EXIT:0，需改 EXIT:2
- 用 `grep -n "non.*existent\|not.*git\|invalid.*cwd" packages/engine/tests/hooks/stop-hook-exit-codes.test.ts` 定位

修复后 commit：
```bash
git -C "$WT" add packages/engine/tests/hooks/stop-hook-exit-codes.test.ts
git -C "$WT" commit -m "test(engine): stop-hook-exit-codes 探测失败场景断言更新（fail-closed）"
```

如 Step 2 全过则跳过 Step 4。

---

## Task 4: Engine 版本 bump 18.17.0 → 18.17.1（patch）

**Files:**
- Modify: `packages/engine/package.json`
- Modify: `packages/engine/package-lock.json`（两处版本）
- Modify: `packages/engine/VERSION`
- Modify: `packages/engine/.hook-core-version`
- Modify: `packages/engine/hooks/.hook-core-version`
- Modify: `packages/engine/hooks/VERSION`
- Modify: `packages/engine/regression-contract.yaml`
- Modify: `packages/engine/skills/dev/SKILL.md`（frontmatter version）

- [ ] **Step 1: 改 7 个版本文件 + 1 个 SKILL.md frontmatter**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict

# package.json
sed -i '' 's/"version": "18.17.0"/"version": "18.17.1"/' "$WT/packages/engine/package.json"

# package-lock.json（两处）
sed -i '' 's/"version": "18.17.0"/"version": "18.17.1"/g' "$WT/packages/engine/package-lock.json"

# VERSION 文件们
echo "18.17.1" > "$WT/packages/engine/VERSION"
echo "18.17.1" > "$WT/packages/engine/.hook-core-version"
echo "18.17.1" > "$WT/packages/engine/hooks/.hook-core-version"
echo "18.17.1" > "$WT/packages/engine/hooks/VERSION"

# regression-contract.yaml
sed -i '' 's/^version: 18.17.0$/version: 18.17.1/' "$WT/packages/engine/regression-contract.yaml"

# SKILL.md frontmatter
sed -i '' 's/^version: 18.17.0$/version: 18.17.1/' "$WT/packages/engine/skills/dev/SKILL.md"
sed -i '' "s/^updated: 2026-05-04$/updated: 2026-05-04/" "$WT/packages/engine/skills/dev/SKILL.md"
```

- [ ] **Step 2: 跑 facts-check + check-cleanup**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
bash "$WT/scripts/check-version-sync.sh" 2>&1 | tail -5
cd "$WT" && bash packages/engine/skills/dev/scripts/check-cleanup.sh 2>&1 | tail -10
```

期望：✅ All version files in sync + ✅ 完工检查通过。

如有版本不一致告警，按错误信息补漏（之前 PR #2745 时 SKILL.md 漏了一次）。

- [ ] **Step 3: commit**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
git -C "$WT" add packages/engine/package.json packages/engine/package-lock.json packages/engine/VERSION packages/engine/.hook-core-version packages/engine/hooks/.hook-core-version packages/engine/hooks/VERSION packages/engine/regression-contract.yaml packages/engine/skills/dev/SKILL.md
git -C "$WT" commit -m "chore(engine): [CONFIG] version bump 18.17.0 → 18.17.1 — classify_session fail-closed"
```

---

## Task 5: feature-registry.yml changelog

**Files:**
- Modify: `packages/engine/feature-registry.yml`

- [ ] **Step 1: 在 changelog: 段最顶部追加 18.17.1 条目**

读 `packages/engine/feature-registry.yml` 找 `changelog:` 段（约 line 8）。在 `  - version: "18.17.0"` 之前插入：

```yaml
  - version: "18.17.1"
    date: "2026-05-04"
    change: "fix"
    description: "classify_session 探测失败 fail-closed（cp-0504140226）— 3 处 not-dev → blocked：cwd 不是目录、git rev-parse --show-toplevel 失败、git rev-parse --abbrev-ref HEAD 失败。消除 PR #2745 后残留的 'PR1 开就停' 故障源（探测异常被误归 not-dev → 误放行）。开发模式中唯一 exit 0 = PR 真完成（done）。"
    files:
      - "packages/engine/lib/devloop-check.sh (classify_session L406/L413/L417 status 字符串)"
      - "packages/engine/tests/integration/devloop-classify.test.sh (Case 2/3 期望 blocked + Case 9/10 新增)"
      - "Engine 7 处版本文件 + SKILL.md frontmatter 18.17.1"
```

- [ ] **Step 2: commit**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
git -C "$WT" add packages/engine/feature-registry.yml
git -C "$WT" commit -m "chore(engine): feature-registry changelog 18.17.1"
```

---

## Task 6: Learning 文件

**Files:**
- Create: `docs/learnings/cp-0504140226-single-exit-strict.md`

- [ ] **Step 1: 写 Learning（含根本原因 + 下次预防 checklist）**

写入 `/Users/administrator/worktrees/cecelia/single-exit-strict/docs/learnings/cp-0504140226-single-exit-strict.md`：

```markdown
# Learning — Stop Hook 二次精修（classify_session fail-closed）

分支：cp-0504140226-single-exit-strict
日期：2026-05-04
Brain Task：60d121d8-2db4-452b-a5fa-6e7e612e16c4
前置 PR：#2745（c1f1e65ed，cp-0504114459）

## 背景

PR #2745 完成 stop hook 散点 12 → 集中 3 处的拓扑归一。但 stop-dev.sh L52 `case not-dev|done) exit 0` 把 not-dev 路径也归到 exit 0。Alex 反复强调真正意图："**一旦确认进入开发模式**（.dev-mode 存在 + cp-* 分支），唯一的 exit 0 = PR 真完成；其他全 exit 2"。

## 根本原因

PR #2745 的 classify_session 把"探测失败"路径也归到 status=`not-dev`：
- cwd 不是目录（文件系统竞态）→ not-dev → exit 0 ✗
- git rev-parse --show-toplevel 失败（git 锁竞态）→ not-dev → exit 0 ✗
- git rev-parse --abbrev-ref HEAD 失败 → not-dev → exit 0 ✗

这意味着在 dev worktree 内，任意一次 git 抖动就会让 stop hook 误放行——这就是 Alex 最早说的"PR1 开就停"的真正源头。

## 本次解法

最小化精修：仅改 classify_session 的 3 处 status 字符串（not-dev → blocked）。

| 路径 | 之前 | 之后 |
|---|---|---|
| bypass env | not-dev | not-dev（保持，明确放行） |
| cwd 不是目录 | not-dev | **blocked**（fail-closed） |
| git rev-parse --show-toplevel 失败 | not-dev | **blocked** |
| git rev-parse --abbrev-ref 失败 | not-dev | **blocked** |
| 主分支 | not-dev | not-dev（保持，明确非 dev） |
| 无 .dev-mode | not-dev | not-dev（保持） |
| .dev-mode 格式异常 | blocked | blocked（保持） |

判定原则：**能明确"用户在跟我聊天"** → not-dev；**任何"我读不到状态"** → blocked（fail-closed）。

stop-dev.sh / stop.sh / 出口拓扑全部不动。实施量 ~10 行 diff。

## 下次预防

- [ ] 任何"探测异常"路径都必须 fail-closed（status=blocked），不能 fail-open（not-dev）
- [ ] 区分"明确语义" vs "探测失败"两类路径——前者放行，后者 block
- [ ] /dev autonomous 模式下任何"自动放行"判定必须有兜底——状态读不到一律 block
- [ ] Research Subagent APPROVED 但带 "必须修复" 提示时，必须当场决定 fix（不要"实施时按发现调整"）
- [ ] 设计 spec 时区分 Alex 的字面要求（"一个 exit 0"）和精神要求（"不要散点误放行"）——后者优先

## 验证证据

- 12 场景 E2E（packages/engine/tests/e2e/stop-hook-full-lifecycle.test.ts）100% 绿灯
- 10 分支 integration（packages/engine/tests/integration/devloop-classify.test.sh）100% 绿灯
- 174+ stop-hook-exit-codes 测试（行为兼容，无需修改测试）
- check-single-exit 守护通过（出口拓扑未变）
```

- [ ] **Step 2: commit learning**

```bash
WT=/Users/administrator/worktrees/cecelia/single-exit-strict
git -C "$WT" add docs/learnings/cp-0504140226-single-exit-strict.md
git -C "$WT" commit -m "docs: Learning — Stop Hook 二次精修 classify_session fail-closed (cp-0504140226)"
```

---

## Self-Review 备注（已做）

1. **Spec 覆盖**：spec 6 步实施顺序 → 本 plan 6 task。验收清单每条都有对应 task 验证。
2. **Placeholder 扫描**：plan 中无 TBD/TODO/占位。
3. **Type 一致性**：`classify_session` 函数名、`status` 字段名、`fail-closed` 概念在 task 间一致。
4. **修订 spec 数字 4 → 3 处**：精读源码发现 L400 bypass 应保留 not-dev（不计入 fail-closed），实际只改 3 处探测失败。本 plan 已用准确数字。
