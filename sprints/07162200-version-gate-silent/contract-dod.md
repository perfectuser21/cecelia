# Contract DoD：版本防线静默修复（07162200）

**Task ID**: d8189a83-3bd3-4da3-ac70-f0ed2ba4ece4  
**版本**: v1.0（首轮，无 reviewer feedback）  
**日期**: 2026-07-17  

---

## [BEHAVIOR] 条目

### [BEHAVIOR-01] src 变更必须 bump 版本（核心门禁）

**描述**：任何 `packages/brain/src/**` 的 PR diff，必须触发版本递增检查  
**测试映射**: `tests/regression/version-gate-silent/check-brain-version-bump.test.js` → GP-1、GP-2  
**验收命令**：
```bash
cd /workspace && npx vitest run tests/regression/version-gate-silent/check-brain-version-bump.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|GP-1|GP-2|改 brain src"
```
**预期输出**：GP-1（exit 0）和 GP-2（exit 1）测试均为 PASS

---

### [BEHAVIOR-02] 非 src 变更不触发门禁

**描述**：仅改 `__tests__/`、`sprints/`、`*.md` 的 PR，门禁脚本跳过检查并 exit 0  
**测试映射**: `tests/regression/version-gate-silent/check-brain-version-bump.test.js` → GP-3  
**验收命令**：
```bash
cd /workspace && npx vitest run tests/regression/version-gate-silent/check-brain-version-bump.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|GP-3|未改 brain src|跳过"
```
**预期输出**：GP-3 测试为 PASS

---

### [BEHAVIOR-03] semver 比较严格大于（支持任意步长）

**描述**：patch/minor/major 三种 bump 步长均视为合法递增，降版本和同版本均拒绝  
**测试映射**: `tests/regression/version-gate-silent/check-brain-version-bump.test.js` → GP-4  
**验收命令**：
```bash
cd /workspace && npx vitest run tests/regression/version-gate-silent/check-brain-version-bump.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|GP-4|semver|patch.*minor.*major"
```
**预期输出**：GP-4 测试为 PASS

---

### [BEHAVIOR-04] 门禁失败时输出可操作 fix 提示

**描述**：exit 1 时，stdout/stderr 必须包含 `npm version patch --no-git-tag-version` 命令示例  
**测试映射**: `tests/regression/version-gate-silent/check-brain-version-bump.test.js` → GP-2 的 stdout 断言  
**验收命令**：
```bash
cd /workspace && npx vitest run tests/regression/version-gate-silent/check-brain-version-bump.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL|fix 提示|npm version patch"
```
**预期输出**：包含 fix 提示的 GP-2 测试为 PASS

---

### [BEHAVIOR-05] CI job brain-version-bump-gate 纳入 ci-passed 聚合

**描述**：新 job 存在于 ci.yml，且在 ci-passed 的 needs 列表中，确保分支保护完整  
**测试映射**: 结构验证（git grep）  
**验收命令**：
```bash
grep -c "brain-version-bump-gate" /workspace/.github/workflows/ci.yml
```
**预期输出**：数字 >= 2（job 定义 + ci-passed needs 至少各出现一次）

---

### [BEHAVIOR-06] 门禁仅在 pull_request 事件触发

**描述**：push-to-main 不触发门禁，由 auto-version.yml 负责 bump，两者职责不重叠  
**测试映射**: ci.yml 静态验证  
**验收命令**：
```bash
grep -A 5 "brain-version-bump-gate:" /workspace/.github/workflows/ci.yml | grep "pull_request"
```
**预期输出**：非空行（含 `github.event_name == 'pull_request'`）

---

### [BEHAVIOR-07] 铁律文件不变（check-version-sync / auto-version / brain-ci-deploy）

**描述**：三个受保护文件内容不得被本 sprint 改动  
**验收命令**：
```bash
git diff main -- scripts/check-version-sync.sh .github/workflows/auto-version.yml .github/workflows/brain-ci-deploy.yml
```
**预期输出**：空（无 diff）

---

### [BEHAVIOR-08] 现有 check-version-sync 测试无回归

**描述**：DEFINITION.md 漂移检测测试仍 PASS，四处一致性职责不受新门禁影响  
**测试映射**: `tests/check-version-sync.test.js`  
**验收命令**：
```bash
cd /workspace && npx vitest run tests/check-version-sync.test.js --reporter=verbose 2>&1 | grep -E "PASS|FAIL"
```
**预期输出**：1 PASS，0 FAIL

---

## 全量验收命令序列（manual:bash）

```bash
# Step 1: 运行合同测试 GP-1 ~ GP-4
cd /workspace && npx vitest run tests/regression/version-gate-silent/check-brain-version-bump.test.js --reporter=verbose

# Step 2: 回归测试（check-version-sync 不破坏）
cd /workspace && npx vitest run tests/check-version-sync.test.js --reporter=verbose

# Step 3: 验证 CI 结构
grep -c "brain-version-bump-gate" /workspace/.github/workflows/ci.yml
grep -A 5 "brain-version-bump-gate:" /workspace/.github/workflows/ci.yml | grep "pull_request"

# Step 4: 验证铁律文件未改动
git diff main -- scripts/check-version-sync.sh .github/workflows/auto-version.yml .github/workflows/brain-ci-deploy.yml

# Step 5: 本地端到端（脚本独立可运行）
BASE_REF=origin/main bash /workspace/scripts/ci/check-brain-version-bump.sh; echo "exit: $?"
```

---

## DoD 完成标准

- [ ] [BEHAVIOR-01] GP-1、GP-2 测试 PASS
- [ ] [BEHAVIOR-02] GP-3 测试 PASS
- [ ] [BEHAVIOR-03] GP-4 测试 PASS
- [ ] [BEHAVIOR-04] GP-2 fix 提示断言 PASS
- [ ] [BEHAVIOR-05] ci.yml 含 brain-version-bump-gate >= 2 次
- [ ] [BEHAVIOR-06] ci.yml 中 brain-version-bump-gate 含 pull_request 条件
- [ ] [BEHAVIOR-07] 三铁律文件 git diff 为空
- [ ] [BEHAVIOR-08] check-version-sync.test.js 仍 PASS
