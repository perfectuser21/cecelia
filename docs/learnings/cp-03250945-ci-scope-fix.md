---
branch: cp-03250945-ci-scope-fix
task_id: 88040740-cdb4-451d-84cf-b9c4e57cc48e
date: 2026-03-25
---

# Learning: CI Scope 深度修复 — routing-map 补全 + ci-evolution-check 扩展扫描

### 根本原因

CI Evolution Gate（`ci-evolution-check.mjs`）只扫描 `packages/*` 和 `apps/*` 两类目录。`scripts/devgate/`、`ci/`、`.github/workflows/` 等关键路径完全不在扫描范围内，修改这些目录时不会触发门禁校验，存在注册遗漏风险。

### 修复方案

1. 在 `ci/routing-map.yml` 末尾追加 4 个条目（devgate-core / ci-helpers / ci-configuration / github-workflows），覆盖上述路径。
2. 在 `scripts/ci-evolution-check.mjs` 的 Check 2 之后新增 Check 4/5/6，分别校验 `scripts/devgate`、`ci`、`.github/workflows` 是否已在 routing-map 中注册（单目录直接检查，而非 listSubdirs 枚举）。

### 下次预防

- [ ] 每当新增顶层目录（非 packages/* / apps/*）时，必须同步在 routing-map.yml 注册并运行 `node scripts/ci-evolution-check.mjs` 验证。
- [ ] ci-evolution-check 的 Check 数量扩展时，编号应保持语义连贯（Check 4/5/6 对应固定路径，Check 3 保留测试目录分类）。
- [ ] DoD Test 字段中 `node -e` 命令禁止使用 `!` 操作符（shell 历史展开会导致 exit 1），改用 `indexOf(...) < 0` 替代 `includes(...)` 加否定。
