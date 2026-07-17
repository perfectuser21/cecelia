# Contract Draft：版本防线静默修复（07162200）

**Task ID**: d8189a83-3bd3-4da3-ac70-f0ed2ba4ece4  
**Sprint Dir**: sprints/07162200-version-gate-silent  
**起草日期**: 2026-07-17  
**基于 PRD**: sprint-prd.md  

---

## 问题陈述

`packages/brain/src/` 源码变更不 bump `package.json` 版本时，CI 全绿放行——因为：
1. `check-version-sync.sh` 只验四处一致性，不验是否递增
2. `ci.yml` 的 brain 相关 job 完全不调用版本检查脚本

---

## 解决方案

新增轻量门禁：`scripts/ci/check-brain-version-bump.sh`  
在 CI 中作为独立 job `brain-version-bump-gate` 运行，并纳入 `ci-passed` 聚合。

---

## 合同边界

### 纳入本合同

- `scripts/ci/check-brain-version-bump.sh` 脚本逻辑
- `.github/workflows/ci.yml` 新增 `brain-version-bump-gate` job
- `.github/workflows/ci.yml` `ci-passed` 的 `needs` 列表新增该 job
- `tests/check-brain-version-bump.test.js` GP-1 ~ GP-4 测试

### 排除本合同

- `scripts/check-version-sync.sh`（不改，四处一致性职责独立）
- `.github/workflows/auto-version.yml`（不改，push-to-main 后自动 bump 独立）
- `.github/workflows/brain-ci-deploy.yml`（不改，Gate3 部署校验独立）

---

## Golden Path 合同

### GP-1：改 brain src 且 bump 了版本 → 门禁通过

**前置条件**：
- PR diff 含 `packages/brain/src/*.js` 文件
- PR 分支 `packages/brain/package.json` version > main 版本（例：1.268.0 > 1.267.0）

**可验证断言**：
- `check-brain-version-bump.sh` 退出码 = 0
- stdout 含 `版本已 bump`

---

### GP-2：改 brain src 未 bump 版本 → 门禁拦截

**前置条件**：
- PR diff 含 `packages/brain/src/*.js` 文件
- PR 分支 version == main 版本（例：均为 1.267.0）

**可验证断言**：
- `check-brain-version-bump.sh` 退出码 = 1
- stdout/stderr 含 `npm version patch`（可操作 fix 提示）
- stdout/stderr 含版本号对比信息

---

### GP-3：未改 brain src（仅改 tests/docs/sprints）→ 门禁跳过

**前置条件**：
- PR diff 仅含 `packages/brain/__tests__/`、`sprints/`、`*.md` 等非 src 路径
- `packages/brain/src/` 无任何变更

**可验证断言**：
- `check-brain-version-bump.sh` 退出码 = 0
- stdout 含 `跳过版本 bump 检查`（或等同跳过提示）

---

### GP-4：改 brain src + version 已是更高值（patch/minor/major 均可）→ 通过

**前置条件**：
- PR diff 含 `packages/brain/src/*.js`
- 分别测试三种步长：
  - patch: PR=1.267.1 > main=1.267.0
  - minor: PR=1.268.0 > main=1.267.0
  - major: PR=2.0.0 > main=1.267.0

**可验证断言**：
- 三种情况下 `check-brain-version-bump.sh` 退出码均 = 0

---

## E2E 验收

### E2E-1：脚本本地独立运行（manual:bash）

```bash
# 在仓库根目录执行，模拟 main 分支 = origin/main
BASE_REF=origin/main bash scripts/ci/check-brain-version-bump.sh
```

**验收标准**：
- 若当前分支改了 src 且 bump 了版本 → exit 0
- 若当前分支改了 src 未 bump → exit 1 且含 `npm version patch` 提示

### E2E-2：CI job 条件验证（manual:bash）

```bash
# 验证 ci.yml 中 brain-version-bump-gate job 存在
grep "brain-version-bump-gate" .github/workflows/ci.yml

# 验证 ci-passed 的 needs 包含该 job
grep -A 5 "ci-passed:" .github/workflows/ci.yml | grep "brain-version-bump-gate"
```

**验收标准**：两条命令均有输出（非空）

### E2E-3：GP-1 ~ GP-4 单元测试全通过（manual:bash）

```bash
cd /workspace && npx vitest run tests/check-brain-version-bump.test.js
```

**验收标准**：4 个测试用例全部 PASS，0 个 FAIL

### E2E-4：check-version-sync 回归不破坏（manual:bash）

```bash
cd /workspace && npx vitest run tests/check-version-sync.test.js
```

**验收标准**：原有 DEFINITION.md 漂移检测测试仍 PASS

---

## 铁律约束（实现必须满足）

| # | 约束 | 验证方式 |
|---|------|---------|
| 1 | src 变更必须 bump（严格 >，不接受 ==） | GP-2 测试 |
| 2 | 非 src 变更不拦截 | GP-3 测试 |
| 3 | semver 支持 patch/minor/major 任意步长 | GP-4 测试 |
| 4 | 不改 check-version-sync.sh | git diff 验证无该文件变更 |
| 5 | 不改 auto-version.yml | git diff 验证无该文件变更 |
| 6 | 不改 brain-ci-deploy.yml | git diff 验证无该文件变更 |
| 7 | 门禁仅 pull_request 事件触发 | ci.yml job 中含 `github.event_name == 'pull_request'` |
| 8 | brain-version-bump-gate 纳入 ci-passed | E2E-2 验证 |
| 9 | 脚本失败时输出含 `npm version patch` | GP-2 测试 stdout 断言 |
| 10 | 脚本接受 BASE_REF 环境变量 | 本地可测 |
