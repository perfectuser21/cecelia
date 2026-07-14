# Contract Draft — lint-contract-test-immutability CI 机械闸

## Sprint 信息

- **Sprint Dir**: `sprints/07141333-contract-test-immutability-ci`
- **目标**: 新增 CI 检查 `lint-contract-test-immutability`，对 harness sprint PR 强制校验测试文件 commit1 后不可修改
- **target_environment**: `local_api`（脚本本地可运行，CI 用 GitHub Actions ubuntu runner）

## 交付物清单

| 产物 | 路径 | 状态 |
|------|------|------|
| 主检查脚本 | `scripts/lint-contract-test-immutability.sh` | 待实现 |
| CI workflow 接线 | `.github/workflows/harness-v5-checks.yml`（新增 Check 6） | 待实现 |
| Failing test（先 commit） | `../../tests/lint-contract-test-immutability.test.ts` | 先 commit |

## 行为规约

### BEHAVIOR-1：违规测试文件 → exit 1 + 清单

当 `sprints/<dir>/tests/*.test.ts` 文件在 commit1 后被修改，脚本以 exit 1 退出，并打印被改文件路径清单（每行一个）。

**验证命令**：
```bash
# fixture 构造：commit1 写入测试文件，commit2 修改它
TMP=$(mktemp -d)
cd "$TMP"
git init -q && git config user.email "ci@test" && git config user.name "CI"
mkdir -p sprints/test-sprint/tests
echo 'original' > sprints/test-sprint/tests/foo.test.ts
git add . && git commit -q -m "feat: add test"
echo 'modified' > sprints/test-sprint/tests/foo.test.ts
git add . && git commit -q -m "chore: ILLEGALLY modify test"
bash /workspace/scripts/lint-contract-test-immutability.sh test-sprint
echo "exit code: $?"
cd /workspace && rm -rf "$TMP"
```

期望：exit 1，且输出包含 `sprints/test-sprint/tests/foo.test.ts`

### BEHAVIOR-2：未修改测试文件 → exit 0

当 `sprints/<dir>/tests/*.test.ts` 文件自 commit1 起未被修改，脚本以 exit 0 退出。

**验证命令**：
```bash
TMP=$(mktemp -d)
cd "$TMP"
git init -q && git config user.email "ci@test" && git config user.name "CI"
mkdir -p sprints/test-sprint/tests
echo 'original' > sprints/test-sprint/tests/foo.test.ts
git add . && git commit -q -m "feat: add test"
# 不修改测试文件，只修改其他文件
echo 'other' > sprints/test-sprint/contract-draft.md
git add . && git commit -q -m "docs: add contract"
bash /workspace/scripts/lint-contract-test-immutability.sh test-sprint
echo "exit code: $?"
cd /workspace && rm -rf "$TMP"
```

期望：exit 0

### BEHAVIOR-3：commit1 历史无法定位 → warn + exit 0（误杀优先）

当无法通过 `git log --diff-filter=A` 定位文件首次 commit（如历史截断），脚本输出 WARN 信息并以 exit 0 退出，不拦 PR。

### BEHAVIOR-4：无测试文件 → exit 0

当 `sprints/<dir>/tests/` 下无 `.test.ts` / `.test.js` 文件，脚本以 exit 0 退出并输出提示。

### BEHAVIOR-5：CI skip（非 harness PR）

当 PR diff 不含 `sprints/*` 路径变更，CI job 输出 "No sprints/* changes, skipping" 并以 exit 0 通过，不执行脚本。

## 铁律约束

- **只加新闸**：本脚本为纯新增 check，不修改任何现有 CI job 逻辑
- **误杀优先**：拿不准时（历史截断、文件不存在、git 命令失败）一律 warn + exit 0，不 fail
- **零外网依赖**：脚本纯 git 命令，不调任何外网服务
- **TDD 顺序**：failing test 先于脚本实现 commit 进 repo

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|------------|-----------|---------------|------------|
| WS1 | `../../tests/lint-contract-test-immutability.test.ts` | BEHAVIOR-1/BEHAVIOR-2/BEHAVIOR-3/BEHAVIOR-4 | 脚本未实现时 exit code 与期望不符 |

## E2E 验收

```bash
#!/usr/bin/env bash
# E2E 验收脚本 — lint-contract-test-immutability
# 运行环境：local / CI ubuntu runner（有 git、bash）
set -euo pipefail

PASS=0
FAIL=0

report() {
  local label="$1" result="$2"
  if [ "$result" = "PASS" ]; then
    echo "✅ $label"
    PASS=$((PASS+1))
  else
    echo "❌ $label"
    FAIL=$((FAIL+1))
  fi
}

# 场景 1：commit1 后测试文件被修改 → 期望 exit 1
TMP1=$(mktemp -d)
(
  cd "$TMP1"
  git init -q && git config user.email "ci@test" && git config user.name "CI"
  mkdir -p sprints/test-sprint/tests
  echo 'original' > sprints/test-sprint/tests/foo.test.ts
  git add . && git commit -q -m "feat: add test"
  echo 'modified' > sprints/test-sprint/tests/foo.test.ts
  git add . && git commit -q -m "chore: modify test"
)
bash /workspace/scripts/lint-contract-test-immutability.sh "$TMP1" test-sprint > /dev/null 2>&1 && SCENE1_EXIT=0 || SCENE1_EXIT=$?
[ "$SCENE1_EXIT" -ne 0 ] && report "场景1：修改后 exit 1" "PASS" || report "场景1：修改后 exit 1" "FAIL"
rm -rf "$TMP1"

# 场景 2：commit1 后测试文件未修改 → 期望 exit 0
TMP2=$(mktemp -d)
(
  cd "$TMP2"
  git init -q && git config user.email "ci@test" && git config user.name "CI"
  mkdir -p sprints/test-sprint/tests
  echo 'original' > sprints/test-sprint/tests/foo.test.ts
  git add . && git commit -q -m "feat: add test"
  echo 'other' > sprints/test-sprint/other.md
  git add . && git commit -q -m "docs: add other"
)
bash /workspace/scripts/lint-contract-test-immutability.sh "$TMP2" test-sprint > /dev/null 2>&1 && SCENE2_EXIT=0 || SCENE2_EXIT=$?
[ "$SCENE2_EXIT" -eq 0 ] && report "场景2：未修改 exit 0" "PASS" || report "场景2：未修改 exit 0" "FAIL"
rm -rf "$TMP2"

# 场景 3：无测试文件 → exit 0
TMP3=$(mktemp -d)
(
  cd "$TMP3"
  git init -q && git config user.email "ci@test" && git config user.name "CI"
  mkdir -p sprints/test-sprint
  echo 'prd' > sprints/test-sprint/sprint-prd.md
  git add . && git commit -q -m "feat: add prd"
)
bash /workspace/scripts/lint-contract-test-immutability.sh "$TMP3" test-sprint > /dev/null 2>&1 && SCENE3_EXIT=0 || SCENE3_EXIT=$?
[ "$SCENE3_EXIT" -eq 0 ] && report "场景3：无测试文件 exit 0" "PASS" || report "场景3：无测试文件 exit 0" "FAIL"
rm -rf "$TMP3"

echo ""
echo "E2E 结果：PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```
