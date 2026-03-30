# Learning: 修复 Sprint Contract Gate 防橡皮图章机制

## 根本原因

Sprint Contract Gate 形同虚设的根本原因是缺少"必须有所发现"的最低压力规则：
1. **spec_review**：Evaluator 可以生成空的 `independent_test_plans` 数组直接 PASS，v1.5.0 的 `divergence_count = 0` 检查只保证了比对，但无法防止 Evaluator 不生成计划
2. **CRG**：stats 可以全零（blocker=0, warning=0, info=0）直接 PASS，等同于没有审查
3. **reviewer_model**：两个 seal 文件从未记录审查者模型，导致无法追溯

## 下次预防

- [ ] 所有 Gate 审查 skill 必须有"最低有效观察"规则：
  - spec_review：`plans.length > 0`（Evaluator 必须生成至少1条独立测试计划）
  - CRG：`stats 非全零`（至少1条 info 级观察）
- [ ] seal 文件必须包含 `reviewer_model` 字段，方便追溯
- [ ] 主 agent 在收到 PASS 后，应额外验证 seal 内容的有效性（plans.length > 0 检查）

## 陷阱：branch-protect.sh PRD 路径检测

branch-protect.sh 的 `find_prd_dod_dir` 函数从文件目录向上遍历，找到第一个含 `.prd*.md` 的目录就返回。`packages/workflows/` 目录有遗留的旧格式 `.prd.md`，导致 hook 误用旧文件检查 PRD。

**解决方案**：在 `packages/workflows/` 目录下也创建 per-branch PRD/DoD 文件（`.prd-{branch}.md` + `.dod-{branch}.md`）。
