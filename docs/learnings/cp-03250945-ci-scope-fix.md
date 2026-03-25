---
branch: cp-03250945-ci-scope-fix
task_id: 88040740-cdb4-451d-84cf-b9c4e57cc48e
date: 2026-03-25
---

## CI Scope 深度修复 — routing-map 补全 + ci-evolution-check 扩展扫描（2026-03-25）

### 根本原因

CI Evolution Gate（`ci-evolution-check.mjs`）初始设计只扫描 `packages/*` 和 `apps/*` 两类目录，目标是检测新增的 npm 子包和前端 app 是否已在 routing-map 中注册。

然而仓库中存在三类同等重要的顶层路径未被纳入扫描：`scripts/devgate/`（DevGate 门禁脚本）、`ci/`（CI 路由和分类配置文件）、`.github/workflows/`（GitHub Actions 工作流定义）。这些路径在 `ci/routing-map.yml` 中也没有对应的注册条目。

两个问题叠加：当开发者修改 `scripts/devgate/` 或 `.github/workflows/` 时，Evolution Gate 不会检测到遗漏注册，CI 门禁形同虚设。

### 修复方案

在 `ci/routing-map.yml` 末尾追加 4 个条目（devgate-core / ci-helpers / ci-configuration / github-workflows），覆盖上述路径。
在 `scripts/ci-evolution-check.mjs` 的 Check 2 之后新增 Check 4/5/6，分别校验 `scripts/devgate`、`ci`、`.github/workflows` 是否已在 routing-map 中注册（单目录直接检查，而非 listSubdirs 枚举）。

### 下次预防

- [ ] 每当新增顶层目录（非 packages/* / apps/*）时，必须同步在 routing-map.yml 注册并运行 `node scripts/ci-evolution-check.mjs` 验证。
- [ ] ci-evolution-check 的 Check 数量扩展时，编号应保持语义连贯（Check 4/5/6 对应固定路径，Check 3 保留测试目录分类）。
- [ ] DoD Test 字段中 `node -e` 命令禁止使用 `!` 操作符（shell 历史展开会导致 exit 1），改用 `indexOf(...) < 0` 替代 `includes(...)` 加否定。
