---
id: learning-dynamic-ci-dev-health
version: 1.0.0
created: 2026-03-14
updated: 2026-03-14
branch: cp-03141045-dynamic-ci-dev-health
changelog:
  - 1.0.0: 初始版本
---

# Learning: /dev 专属健康保护 + CI Dev Health Gate（2026-03-14）

### 根本原因

1. **.dev-lock context 压缩恢复缺口**：context 压缩重载后 `.dev-lock.<branch>` 不在恢复列表中，Stop Hook 找不到它 → exit 0 快速路径 → 整个循环机制无声失效
2. **bash 单字符局部变量编码污染**：含中文注释的 bash 文件中，单字符变量名（`p`）易被相邻中文字符的 Unicode 零宽字符污染，导致 `p°: unbound variable`
3. **/dev 无专属 CI 守护**：Stop Hook、branch-protect 逻辑改坏无任何 CI 检测，整个自主系统可静默瘫痪

### 下次预防

- [ ] bash 函数中避免使用单字符局部变量名，用描述性长名（`path_to_check`、`hook_file`）
- [ ] 新增任何高风险基础设施路径时，同步更新 `required-dev-paths.yml`
- [ ] /dev 相关文件修改（skills/dev/、hooks/）必须先跑 `bash test-dev-health.sh` 本地验证
- [ ] DoD Test 命令禁止 `&& echo OK` 模式，改用 `grep -c`（输出数字，非零即通过）

## 背景

/dev 是 Cecelia 系统的 meta 层——所有自主开发任务都通过 /dev 完成。但 /dev 自身没有健康检查：Stop Hook 坏了、`.dev-lock` 丢了、branch-protect 失效，整个自主系统立即瘫痪，且无任何 CI 能发现。

## 核心发现

### .dev-lock context 压缩恢复缺口

- **根因**：context 压缩重载后，`.dev-lock.<branch>` 不在重载的文件列表中，但 `.dev-mode.<branch>` 保留
- **后果**：Stop Hook 找不到 `.dev-lock` → 走快速路径 exit 0 → 整个循环机制失效
- **修复**：Step 00 在检测到已在 worktree 时，检查 `.dev-mode` 存在但 `.dev-lock` 不存在的情况，自动 `cp` 重建

### bash 函数局部变量编码陷阱

- **根因**：在某些终端或编辑器中，中文注释行的编码可能污染相邻变量名（Unicode 零宽字符等）
- **症状**：`p°: unbound variable`——变量名 `p` 含不可见 Unicode 字符
- **修复**：将局部变量改为更长的无歧义名称（`path_to_check`），避免单字符变量与编码问题叠加
- **规则**：bash 函数中避免使用单字符局部变量名，尤其是在含中文的文件中

### CI 静态 vs 动态的根本问题

- **现象**：DevGate 是静态写死的检查清单，不随系统功能增长
- **应对方向（本次部分）**：`required-dev-paths.yml` 是动态扩展点——随着新高风险路径被识别，持续向此文件追加
- **长期方向**：Bazel/TAP affected testing 模型——从依赖图计算受影响模块，只跑相关测试

## 实现要点

### test-dev-health.sh 5 项检查

1. Hook 语法检查（`bash -n`）—— 覆盖 stop.sh / stop-dev.sh / branch-protect.sh / bash-guard.sh
2. Stop Hook 无锁文件 exit 0 验证——创建临时 git 仓库，无 `.dev-lock.*` 时应 exit 0
3. `.dev-lock` 必填字段验证——`branch:` + `provider:` 两个字段
4. Step 00 含 `.dev-lock` 重建逻辑——grep 关键词 + 版本号 >= 2.2.0 验证
5. required-dev-paths.yml 覆盖 4 个高风险路径

### dev-health-check job 设计

- 依赖 `changes.outputs.engine == 'true'`（engine 变更时才触发）
- 不依赖 Node.js，纯 bash，5 分钟超时
- l1-passed gate 中加入 engine 条件检查（与 engine-l1 同一 `if` 块）

## 改动清单

| 文件 | 改动 |
|------|------|
| `packages/engine/skills/dev/steps/00-worktree-auto.md` | v2.1.0→2.2.0，新增 .dev-lock 完整性检查 |
| `packages/engine/scripts/test-dev-health.sh` | NEW，5 项健康检查 |
| `.github/workflows/ci-l1-process.yml` | 新增 dev-health-check job + l1-passed 条件 |
| `packages/engine/config/required-dev-paths.yml` | 新增 packages/engine/skills/dev/ |
| `packages/engine/features/feature-registry.yml` | 3.45.0→3.46.0 |
| 6 个版本文件 | 12.63.0→12.64.0 |
