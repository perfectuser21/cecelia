# Learning: Engine Dev 线升级 — code-quality + prd-audit Codex 门禁

## 任务概要
将 /dev SKILL.md 中的 subagent prompt 建议升级为西安 Codex 异步执行的硬门禁。新增 code-quality 和 prd-audit 两个 Engine Skill，更新 devloop-check.sh 条件顺序（所有审查在 CI 之前）。

### 根本原因
原有的代码质量检查（cleanup subagent、3 个 code reviewer、PRD 语义审计）只是 SKILL.md 中的 prompt 建议，Claude Code 执行时可能跳过，且 devloop-check.sh 完全不检查这些步骤是否执行。代码质量防线存在"纸上谈兵"的空隙——闭环判断（stop hook）只看 PR/CI/Learning 状态，不看代码质量审查结果。

### 下次预防
- [ ] 新增 Codex 异步检查点时，遵循 3 文件联动模式：task-router.js（注册）+ devloop-check.sh（门禁）+ SKILL.md（prompt）
- [ ] devloop-check.sh 的条件编号变更后，同步更新 Task Card 中引用的条件编号（如 `条件 2: CI` → `条件 3: CI`）
- [ ] 改 task-router.js 后必须同步：DEFINITION.md task_types 表 + brain-manifest.generated.json（两个容易漏）
- [ ] 新 Codex skill 的 review_result 输出中必须包含 PASS 或 FAIL 关键字——devloop-check.sh 用 grep -qi 检测，不含关键字会导致永远 blocked

## CI 失败记录
- CI 失败 1 次：facts-check 发现 DEFINITION.md 缺少新 task_type（code_quality_review、prd_coverage_audit）→ 修复后重新 push
