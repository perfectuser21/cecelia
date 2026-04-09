# Contract Review Feedback (Round 3)

review_task_id: b52ce6fb-e537-4b56-8dc2-fcaf7f932ea1
propose_task_id: 263a86f6-f45b-4faf-8adb-2df615fb8283
verdict: REVISION
issues_count: 4

---

## 必须修改项

### 1. [路径错误 — F2 不稳定点1] check-dod-mapping.cjs 引用了不存在的文件

**问题**: 合同写 `packages/engine/scripts/devgate/check-dod-mapping.cjs`，但实际代码库中该文件**不存在**。功能等价的文件是 `scripts/devgate/check-manual-cmd-whitelist.cjs`（不同路径+不同文件名）。

**影响**: Generator 即使正确实现白名单校验逻辑，验证命令也会以 `ENOENT` 失败，永远无法通过。这是一个"正确实现也报错"的阻断性问题。

**现状验证**:
```
$ node -e "require('fs').readFileSync('packages/engine/scripts/devgate/check-dod-mapping.cjs')"
Error: ENOENT: no such file or directory
```

**建议**: 统一合同中的文件路径为实际存在的文件名，有两个选项：
- **选项A（推荐）**: 将验证命令路径改为 `scripts/devgate/check-manual-cmd-whitelist.cjs`（使用现有文件）
- **选项B**: 明确要求 Generator 在 `packages/engine/scripts/devgate/check-dod-mapping.cjs` 创建新文件（并在合同中说明"此文件需新建"）

---

### 2. [路径错误 — F4] engine-ci.yml 引用了不存在的 CI 文件

**问题**: F4 验证命令读取 `.github/workflows/engine-ci.yml`，但该文件**不存在**。代码库中实际 CI 文件为 `.github/workflows/ci.yml`，其中包含 `e2e-smoke` job。

**影响**: 验证命令会 ENOENT 失败，Generator 无法通过向不存在的文件写入内容来满足合同。

**现状验证**:
```
$ ls .github/workflows/
auto-version.yml  ci.yml  cleanup-merged-artifacts.yml  deploy.yml  pr-review.yml
# engine-ci.yml 不存在
```

**建议**: 两个选项：
- **选项A（推荐）**: 将验证命令改为检查 `.github/workflows/ci.yml` 中是否含 `e2e-integrity-check`
- **选项B**: 明确要求 Generator 新建 `engine-ci.yml` 并在合同中说明"此为新文件"

---

### 3. [核心行为未验证 — F4] "≥5 PASS 检测点" 没有对应验证命令

**问题**: F4 硬阈值明确要求"脚本输出中包含 PASS 字符串（≥5 项检测点）"，但 4 条 F4 验证命令全部是**静态检查**（文件存在、可执行权限、关键词检索）。没有任何命令实际**运行**脚本并统计 PASS 输出数量。

**影响**: 以下伪实现可以通过所有 F4 验证命令：
```bash
#!/bin/bash
# e2e-integrity-check.sh
echo "PASS: placeholder"  # 只有1个PASS，但验证命令不会检测数量
```

**建议**: 增加一条验证命令，实际运行脚本并断言 PASS 数量 ≥ 5：
```bash
# 新增：运行脚本并验证 PASS 数量
bash -c '
  SCRIPT="packages/engine/scripts/e2e-integrity-check.sh"
  OUTPUT=$(bash "$SCRIPT" 2>&1)
  PASS_COUNT=$(echo "$OUTPUT" | grep -c "^PASS:")
  [ "$PASS_COUNT" -ge 5 ] && echo "PASS: 脚本输出 $PASS_COUNT 个检测点" || (echo "FAIL: PASS 数量=$PASS_COUNT，期望≥5"; exit 1)
'
```

---

### 4. [候选路径含糊 — F1 场景5/F2 不稳定点3] check-learning-format.sh 在代码库中不存在

**问题**: F1 场景5 和 F2 不稳定点3 的验证命令遍历 3 个候选路径，但 `check-learning-format.sh` 在整个代码库中**均不存在**。合同既没有说明"需新建此文件"，也没有指定应创建在哪个路径。

**影响**: Generator 需要猜测在哪个候选路径创建脚本才能通过验证。如果 Generator 选择了 3 个路径中错误的一个，验证命令仍会失败（因为遍历顺序以第一个存在的路径为准）。

**建议**: 在合同中明确指定：
1. 此脚本需要新建（当前不存在）
2. 明确一个唯一路径，例如 `packages/engine/ci/scripts/check-learning-format.sh`
3. 或者将候选路径改为确定性的单路径检查

---

## 可选改进

### [F1 场景2 AND 逻辑偏弱]
条件 `!c.includes('echo') && !c.includes('>&2')` 使用 AND，意味着只要文件含有任意 `echo`（哪怕是 `echo "starting..."`），第一个条件即通过。实际上几乎所有 shell 脚本都含 `echo`，该条件形同虚设。可改为 OR：`!c.includes('echo') || !c.includes('>&2')`，或直接删除第一个条件，仅保留 FAIL/ERROR/失败 关键词检查（已足够有意义）。

---

## 已通过项（不需修改）

- F1 场景1: stop-dev.sh `_collect_search_dirs` + `.dev-lock` ✅
- F1 场景4: devloop-check.sh 含精确冲突词 ✅
- F2 不稳定点2: branch-protect.sh 含 worktree 路径检测 ✅
- F2 不稳定点4: stop-dev.sh worktree 全扫描 ✅
- F3 评估报告结构检查命令格式正确 ✅
- F4 脚本独立运行（不依赖 Brain API）检查 ✅

---

## 修订优先级

| 编号 | 类型 | 严重度 | 原因 |
|------|------|--------|------|
| 1 | 路径错误 | **阻断** | 正确实现也无法通过验证 |
| 2 | 路径错误 | **阻断** | 正确实现也无法通过验证 |
| 3 | 验证漏洞 | **高** | 核心行为（≥5 PASS）无命令验证 |
| 4 | 路径含糊 | **中** | Generator 无法确定创建路径 |
