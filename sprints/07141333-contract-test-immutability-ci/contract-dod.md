# Contract DoD — lint-contract-test-immutability CI 机械闸

## DoD 条目

### [BEHAVIOR-1] 违规测试文件 → exit 1 + 清单输出

- **描述**: `sprints/<dir>/tests/*.test.ts` 文件在 commit1 后被修改时，脚本以 exit 1 退出并打印被改文件路径（每行一个）
- **验收方式**: `manual:bash`
- **验收命令**:
  ```bash
  TMP=$(mktemp -d)
  cd "$TMP"
  git init -q && git config user.email "ci@test" && git config user.name "CI"
  mkdir -p sprints/test-sprint/tests
  echo 'original' > sprints/test-sprint/tests/foo.test.ts
  git add . && git commit -q -m "feat: add test"
  echo 'modified' > sprints/test-sprint/tests/foo.test.ts
  git add . && git commit -q -m "chore: ILLEGALLY modify test"
  bash /workspace/scripts/lint-contract-test-immutability.sh "$TMP" test-sprint
  EXIT=$?
  cd /workspace && rm -rf "$TMP"
  [ "$EXIT" -ne 0 ] && echo "PASS: exit $EXIT" || echo "FAIL: expected non-0, got 0"
  ```
- **期望结果**: exit code 非 0，输出包含 `sprints/test-sprint/tests/foo.test.ts`

---

### [BEHAVIOR-2] 未修改测试文件 → exit 0

- **描述**: `sprints/<dir>/tests/*.test.ts` 文件自 commit1 起未被修改，脚本以 exit 0 退出
- **验收方式**: `manual:bash`
- **验收命令**:
  ```bash
  TMP=$(mktemp -d)
  cd "$TMP"
  git init -q && git config user.email "ci@test" && git config user.name "CI"
  mkdir -p sprints/test-sprint/tests
  echo 'original' > sprints/test-sprint/tests/foo.test.ts
  git add . && git commit -q -m "feat: add test"
  echo 'other' > sprints/test-sprint/contract-draft.md
  git add . && git commit -q -m "docs: add contract"
  bash /workspace/scripts/lint-contract-test-immutability.sh "$TMP" test-sprint
  EXIT=$?
  cd /workspace && rm -rf "$TMP"
  [ "$EXIT" -eq 0 ] && echo "PASS" || echo "FAIL: expected 0, got $EXIT"
  ```
- **期望结果**: exit code 0

---

### [BEHAVIOR-3] commit1 历史无法定位 → warn + exit 0

- **描述**: 当 `git log --diff-filter=A` 无法定位文件首次 commit（历史截断），脚本输出 WARN 并以 exit 0 退出，不拦 PR
- **验收方式**: `manual:bash`
- **验收命令**:
  ```bash
  TMP=$(mktemp -d)
  cd "$TMP"
  git init -q && git config user.email "ci@test" && git config user.name "CI"
  # 构造浅克隆场景：直接写文件到工作区但不 commit（git log 查不到 commit1）
  mkdir -p sprints/test-sprint/tests
  echo 'some content' > sprints/test-sprint/tests/foo.test.ts
  git add . && git commit -q -m "initial"
  # shallow clone 模拟：truncate history
  git clone --depth=1 file://"$TMP" "${TMP}-shallow"
  bash /workspace/scripts/lint-contract-test-immutability.sh "${TMP}-shallow" test-sprint
  EXIT=$?
  cd /workspace && rm -rf "$TMP" "${TMP}-shallow"
  [ "$EXIT" -eq 0 ] && echo "PASS: warned and exited 0" || echo "FAIL: expected 0, got $EXIT"
  ```
- **期望结果**: exit code 0，输出包含 WARN 关键字

---

### [BEHAVIOR-4] 无测试文件 → exit 0

- **描述**: `sprints/<dir>/tests/` 下无 `.test.ts` / `.test.js` 文件时，脚本以 exit 0 退出并输出提示
- **验收方式**: `manual:bash`
- **验收命令**:
  ```bash
  TMP=$(mktemp -d)
  cd "$TMP"
  git init -q && git config user.email "ci@test" && git config user.name "CI"
  mkdir -p sprints/test-sprint
  echo 'prd' > sprints/test-sprint/sprint-prd.md
  git add . && git commit -q -m "feat: add prd"
  bash /workspace/scripts/lint-contract-test-immutability.sh "$TMP" test-sprint
  EXIT=$?
  cd /workspace && rm -rf "$TMP"
  [ "$EXIT" -eq 0 ] && echo "PASS" || echo "FAIL: expected 0, got $EXIT"
  ```
- **期望结果**: exit code 0

---

### [BEHAVIOR-5] CI skip（非 harness PR diff）→ job 输出 skip + exit 0

- **描述**: PR diff 不含 `sprints/*` 路径变更时，CI job 输出 "No sprints/* changes, skipping" 并以 exit 0 通过
- **验收方式**: `manual:bash`（CI 逻辑在 harness-v5-checks.yml `changes` job 中，本地可用 git diff 模拟）
- **验收命令**:
  ```bash
  # 模拟 CI changes 检测逻辑
  FILES="packages/brain/src/server.js
  packages/engine/src/tool.ts"
  echo "Simulated PR diff files:"
  echo "$FILES"
  HIT=false
  if echo "$FILES" | grep -vE '^sprints/archive/' | grep -qE '^sprints/'; then
    HIT=true
  fi
  [ "$HIT" = "false" ] && echo "PASS: would skip (no sprints/* changes)" || echo "FAIL: would not skip"
  ```
- **期望结果**: 输出 "would skip"

---

## 额外约束（非 BEHAVIOR）

- **[INVARIANT] 只加新闸**：脚本和 CI job 为纯新增，不修改任何现有 CI job 或脚本
- **[INVARIANT] 误杀优先**：任何 git 命令失败、历史截断、文件不存在情况，一律 warn + exit 0
- **[INVARIANT] TDD 顺序**：failing test 文件必须先于 `scripts/lint-contract-test-immutability.sh` 实现 commit 进 repo（手动验证：`git log --oneline` 中含 "(Red)" 的 failing test commit 必须早于含 "(Green)" 的脚本实现 commit）
- **[INVARIANT] 零外网依赖**：脚本仅使用 `git`、`bash`、`grep` 等标准工具
