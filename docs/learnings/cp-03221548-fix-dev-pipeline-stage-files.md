---
branch: cp-03221548-fix-dev-pipeline-stage-files
date: 2026-03-22
task_id: 27581a85-d52b-4493-ad01-37b9d38bc498
---

# Learning: 修复 /dev pipeline Stage 步骤文件 P0/P1/P2 问题

## 根本原因

多个 Stage 步骤文件在迭代过程中积累了编号重复、逻辑错误和描述不准确的问题：

1. **02-code.md 编号重复**：版本迭代时新增步骤没有重新编排整体序号，导致两个 2.3.5
2. **verify-step.sh 单包限制**：Gate 1 写死了 `cd packages/engine && npm test`，忽略了 brain/apps 改动
3. **verify-step.sh Gate 2 只验证 [BEHAVIOR]**：原始实现用硬编码字符串匹配，未考虑 [ARTIFACT]/[GATE] 类型
4. **01-spec.md 无上限重试**：缺少超限告警机制，长期重试不可观测
5. **04-ship.md 字段兼容**：brain_task_id 和 task_id 两个字段名在历史版本演化中未统一处理
6. **SKILL.md "不要停顿"歧义**：原文说"不要停顿"又说"等 stop hook 放行"，造成理解矛盾

## 关键修复

- verify-step.sh Gate 1：根据 `git diff --name-only` 检测 engine/brain/apps 改动，分别跑对应 npm test
- verify-step.sh Gate 2：扩展 IN_BEHAVIOR 判断逻辑，同时匹配 [BEHAVIOR]/[ARTIFACT]/[GATE] 三种条目类型（保留 IN_BEHAVIOR 变量名以兼容现有测试）
- 02-code.md：重新编号 2.3.1-2.3.6，顺序改为：npm test → 垃圾清理 → CI镜像 → DoD Test → Task Card hash → 完整CI镜像

## 下次预防

- [ ] 新增步骤时检查编号连续性（grep `### N.M.\d+` 验证 Set 大小）
- [ ] verify-step.sh 修改后必须跑 Engine npm test，测试文件会检查关键变量名
- [ ] 修改 verify-step.sh 中的变量名前，先搜索 `verify-step.test.ts` 中的引用
- [ ] SKILL.md 中的"不要停顿"和"等 stop hook 放行"是不同的概念：subagent 调用是同步的，stop hook 是在会话结束时异步检查

