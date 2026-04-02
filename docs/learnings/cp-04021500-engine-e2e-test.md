---
id: learning-cp-04021500-engine-e2e-test
branch: cp-04021500-engine-e2e-test
created: 2026-04-02
type: learning
---

# Learning: Engine E2E 测试补全

## 做了什么
扩展 `packages/engine/tests/e2e/dev-workflow-e2e.test.ts`，从 13 个测试扩展到 23 个，覆盖 devloop-check.sh 全部 7 个判断条件。

## 关键发现
1. devloop-check.sh 的条件检查是严格线性的（0→1→2→2.6→3→4→5→6），每个条件都返回 exit 2 阻塞
2. cleanup_done 条件具有最高优先级，即使其他 step 全是 pending 也能 exit 0
3. 条件 3（PR 检查）依赖 gh CLI，在无 PR 的测试环境下自然返回空值

### 根本原因
原 E2E 测试只覆盖了 Step 0（worktree）、条件 1-2（step_1/step_2 状态）和 Stop Hook 基本行为。缺失的条件 2.6（DoD 完整性）、条件 3（PR 创建）、条件 0 优先级、以及完整推进序列未被验证。

### 下次预防
- [ ] 新增 devloop-check 条件时，同步在 E2E 测试中添加对应的测试用例
- [ ] E2E 测试文件头部注释保持与 devloop-check.sh 条件列表同步

## 测试策略
- 使用 `makeTmpRepo()` 创建临时 git repo + .dev-mode 文件
- 通过 `spawnSync` 调用 bash 执行 devloop_check 函数
- 检查 exit code（0=done, 2=blocked）和 stdout/stderr 输出
