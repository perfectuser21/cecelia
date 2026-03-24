# Learning: crystallize task type — 替代 codex_playwright

**Branch**: cp-03241220-crystallize-task-type
**Date**: 2026-03-24
**PR**: feat(brain): crystallize task type — 能力蒸馏4步流水线，替代 codex_playwright

---

## 根本原因

`codex_playwright` + `playwright-auto` 是2步原型（探索+执行），缺少 Scope（目标定义）和 Register（产出注册）两个关键环节，导致每次探索结果无法沉淀为可复用的能力。

---

## 解决方案

引入 `crystallize` task type（能力蒸馏）：4步完整流水线

```
Scope → Forge → Verify → Register
```

- **Scope**: 定义 DoD + 验收标准（crystallize_scope）
- **Forge**: Codex 探索写 Playwright 脚本（crystallize_forge，复用 playwright-runner.sh）
- **Verify**: 无 LLM 验证脚本3次（crystallize_verify）
- **Register**: 注册到 SKILL.md + 部署（crystallize_register）

当 Verify 失败时（最多 MAX_VERIFY_RETRY=3 次），重新 Forge 并携带 `retry_count`。

---

## 关键工程决策

### retry_count 传递链路

```
forge(retry=N) → verify(retry=N) → [失败] → forge(retry=N+1) → verify(retry=N+1) → ...
```

retry_count 必须在 forge→verify 时一并传入 verify 的 payload，否则 verify 失败时读到的 retry_count 永远是0，导致无限重试。

### DB constraint 覆盖补全

Migration 184 借机补全了之前代码层已使用但未入约束的 task_type：
- content-pipeline 系列（content-research/generate/review/export）
- okr 飞轮系列（okr_initiative_plan/scope_plan/project_plan）

### packages/workflows/ 双写 PRD/DoD

在 packages/workflows/ 子树开发时，branch-protect hook 就近检测 PRD/DoD。必须同时在：
1. worktree 根目录创建 `.prd-{branch}.md`
2. `packages/workflows/` 创建 `.prd-{branch}.md` + `.dod-{branch}.md`

否则 hook 找到旧任务的 `.prd.md` 会报错。

---

## 下次预防

- [ ] 新建 task type 时，直接从4步流水线模板出发，不要从2步原型起步
- [ ] orchestrator 中 retry 逻辑的 payload 传递：凡是"失败重试"场景，必须把计数器带入下一阶段 payload
- [ ] packages/workflows/ 子树开发：在 Step 0 创建 worktree 后立刻在两处创建 PRD/DoD 文件
- [ ] DB constraint migration 时顺手补齐代码层已用但未入约束的 task_type
