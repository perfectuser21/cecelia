# 小改动 PrepPRD：收紧 zenithjoy-skills 匹配 + 接入 CI

## 改什么
1. `packages/engine/hooks/pre-commit`：把子串匹配 `*"zenithjoy-skills"*` 改成锚定 repo basename 的正则匹配，避免 `zenithjoy-skills-v2` 之类同前缀仓库被误豁免。
2. 把 `tests/hooks/test-pre-commit.sh` 迁移到 `packages/engine/tests/integration/pre-commit.test.sh`——调研发现 CI 里已有 `engine-tests-shell` job 会自动 glob 扫描这个目录并把它纳入 `ci-passed` 必过项，不需要新增 workflow 文件（详见 design 文档）。

## 为什么改
PR #3666 final review 提的两个 nice-to-have，用户已确认要做。

## 关联上下文
- 相关历史决策：无匹配
- 相关 in-progress task：无冲突

## 影响范围
收紧 pre-commit hook 匹配精度（不误伤现有场景），新增 CI workflow 不影响现有 workflow。

## 验收标准
- [x] packages/engine/tests/integration/pre-commit.test.sh 7/7 通过（含新增"zenithjoy-skills-v2 不应被豁免"用例）
- [x] 迁移后的测试文件被既有 engine-tests-shell job 的 glob 自动捡起，成为 ci-passed 必过项
- [x] CI 全绿
