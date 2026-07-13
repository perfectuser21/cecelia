# pre-commit hardening + CI 接入 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 收紧 `packages/engine/hooks/pre-commit` 的 zenithjoy-skills 判断为 basename 锚定正则，并把测试迁移到既有 CI 自动跑的目录，让回归有机器闸门守着。

**Architecture:** 测试文件从 `tests/hooks/test-pre-commit.sh` 迁移到 `packages/engine/tests/integration/pre-commit.test.sh`（命名匹配 `.test.sh` 后缀，会被 `.github/workflows/ci.yml` 里既有的 `engine-tests-shell` job 自动 glob 捡起，无需新增 workflow 或改 `ci-passed` 的 needs 数组）。迁移后新增第7条用例验证 `zenithjoy-skills-v2` 不被误豁免（Red），然后把 `pre-commit` 的匹配逻辑从子串改成正则（Green）。

**Tech Stack:** Bash

## Global Constraints

- 正则必须同时匹配 `https://github.com/x/zenithjoy-skills.git`、`https://github.com/x/zenithjoy-skills`（无.git后缀）、`git@github.com:x/zenithjoy-skills` 三种形式
- 正则必须排除 `zenithjoy-skills-v2`、`zenithjoy-skills-private` 等同前缀仓库
- 不新增 `.github/workflows/*.yml` 文件，不改动 `.github/workflows/ci.yml`
- 迁移后的测试文件里 `HOOK_SRC` 计算逻辑不用改（`$(dirname)/../..`  在新位置 `packages/engine/tests/integration/` 下恰好也指向 `packages/engine`，拼上 `/hooks/pre-commit` 依然正确解析到同一个物理文件）

---

### Task 1: 迁移测试文件到 CI 自动扫描目录 + 追加豁免收紧用例（Red）

**Files:**
- Delete: `tests/hooks/test-pre-commit.sh`
- Create: `packages/engine/tests/integration/pre-commit.test.sh`
- Modify: `packages/engine/feature-registry.yml`（更新 files 引用路径）

**Interfaces:**
- Consumes: 无
- Produces: 无（叶子任务，`pre-commit.test.sh` 本身不被后续任务的代码依赖，只被 CI 调用）

- [ ] **Step 1: 读取现有测试文件内容，原样迁移到新路径**

```bash
cat tests/hooks/test-pre-commit.sh
```

把读到的完整内容，一字不改地写入新文件：

```bash
mkdir -p packages/engine/tests/integration
git mv tests/hooks/test-pre-commit.sh packages/engine/tests/integration/pre-commit.test.sh
```

（用 `git mv` 保留文件历史；内容本身不动，`HOOK_SRC` 那行不用改——它的相对路径逻辑在新位置依然正确解析到 `packages/engine/hooks/pre-commit`。）

- [ ] **Step 2: 在迁移后的文件末尾（`echo ""` 之前）追加第7条用例**

在 `packages/engine/tests/integration/pre-commit.test.sh` 里找到这一段：

```bash
run_test_with_origin "非 zenithjoy-skills 仓库 main 分支仍被拒绝（对照组，防误伤）" 1 "main" "https://github.com/perfectuser21/cecelia.git"
```

在它后面追加一行：

```bash
run_test_with_origin "zenithjoy-skills-v2 仓库不应被误豁免（收紧匹配）" 1 "main" "https://github.com/perfectuser21/zenithjoy-skills-v2.git"
```

- [ ] **Step 3: 跑测试确认新用例失败（其余6条应仍PASS）**

Run: `bash packages/engine/tests/integration/pre-commit.test.sh`
Expected: 前6条 `✅ PASS`；`zenithjoy-skills-v2 仓库不应被误豁免（收紧匹配）` 报 `❌ FAIL (expected exit=1, got exit=0)`——因为当前子串匹配会把 `zenithjoy-skills-v2.git` 误判成含 `zenithjoy-skills`，错误放行（exit 0），这正是 Task 2 要修的问题，属于预期 Red。

- [ ] **Step 4: 同步更新 feature-registry.yml 里的文件路径引用**

找到 `packages/engine/feature-registry.yml` 里这一段（在本次改动新增的 changelog 条目里）：

```yaml
    files:
      - packages/engine/hooks/pre-commit
      - tests/hooks/test-pre-commit.sh
```

改成：

```yaml
    files:
      - packages/engine/hooks/pre-commit
      - packages/engine/tests/integration/pre-commit.test.sh
```

- [ ] **Step 5: commit（Red）**

```bash
git add tests/hooks/test-pre-commit.sh packages/engine/tests/integration/pre-commit.test.sh packages/engine/feature-registry.yml
git commit -m "test(engine): 迁移pre-commit测试到CI自动扫描目录+追加收紧用例（Red）

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: 收紧豁免匹配为正则（Green）

**Files:**
- Modify: `packages/engine/hooks/pre-commit`

**Interfaces:**
- Consumes: 无
- Produces: 无（终端任务）

- [ ] **Step 1: 修改匹配逻辑**

把 `packages/engine/hooks/pre-commit` 里这一行：

```bash
if [[ "$ORIGIN_URL" == *"zenithjoy-skills"* ]]; then
```

改成：

```bash
if [[ "$ORIGIN_URL" =~ /zenithjoy-skills(\.git)?/?$ ]]; then
```

- [ ] **Step 2: 跑测试确认全部变绿**

Run: `bash packages/engine/tests/integration/pre-commit.test.sh`
Expected:
```
✅ PASS: main 分支被拒绝
✅ PASS: cp-* 分支无 .dev-mode 被拒绝
✅ PASS: cp-* 分支有 .dev-mode 放行
✅ PASS: feature/* 分支被拒绝
✅ PASS: zenithjoy-skills 仓库 main 分支直接放行
✅ PASS: 非 zenithjoy-skills 仓库 main 分支仍被拒绝（对照组，防误伤）
✅ PASS: zenithjoy-skills-v2 仓库不应被误豁免（收紧匹配）

结果: 7 通过, 0 失败
```

- [ ] **Step 3: 手动验证 CI 会捡起这个文件（确认 glob 匹配）**

Run: `ls packages/engine/tests/integration/*.test.sh | grep pre-commit`
Expected: 输出 `packages/engine/tests/integration/pre-commit.test.sh`（证明命名匹配 `ci.yml` 里 `engine-tests-shell` job 的 glob `packages/engine/tests/integration/*.test.sh`）

- [ ] **Step 4: 跑 engine hygiene check 确认没引入版本不同步问题**

Run: `node packages/engine/scripts/devgate/check-engine-hygiene.cjs`
Expected: `[OK] Engine hygiene: all checks passed`

- [ ] **Step 5: commit（Green）**

```bash
git add packages/engine/hooks/pre-commit
git commit -m "feat(hooks): pre-commit zenithjoy-skills 匹配收紧为basename锚定正则（Green）

子串匹配会误豁免 zenithjoy-skills-v2 之类同前缀仓库，改用正则锚定
repo basename，同时兼容 .git 后缀/无后缀/SSH三种URL形式。

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## Self-Review

- **Spec coverage**：收紧匹配（Task 2）✅ / 迁移到CI自动扫描目录（Task 1）✅ / feature-registry.yml引用同步（Task 1 Step 4）✅ / 新增防误伤用例（Task 1 Step 2）✅。
- **Placeholder scan**：无 TBD，所有代码块可直接使用。
- **Type consistency**：`run_test_with_origin` 沿用 Task 1（上一个PR）already验证过的 helper，签名不变。
