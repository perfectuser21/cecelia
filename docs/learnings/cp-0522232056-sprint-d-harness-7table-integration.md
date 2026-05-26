# Sprint D — Harness Pipeline × Brain DB 7张表集成（2026-05-22）

## 任务简述

打通 Harness pipeline 与 Brain DB 7张表的三个集成点：
1. 新增 GET /api/brain/journey_features + 修复 registry.js `registered_at` 列名 bug
2. feature_id 在 harness 任务链（propose→review→generate→evaluate）中完整传播
3. evaluator PASS 后自动回写 journey_features.thickness = 'medium'
4. harness-planner SKILL.md Step 0.1 扩展为读 7 张表
5. harness-contract-proposer SKILL.md Step 2 加注册表防冲突查询

### 根本原因

- **registry 500 bug**：`registry.js` 第99行 SELECT 列名写的是 `registered_at`，但表实际列名是 `created_at`，导致所有 `/api/brain/registry` 查询一直返回 500，注册表功能完全失效。这是一个上线后从未被捕获的隐性 bug，因为没有针对真实 SQL 列名的集成测试。
- **feature_id 传播缺失**：execution.js 的 createHarnessTask 调用没有把 feature_id 从 initiative payload 传下去，导致 evaluator 到达 PASS 时已丢失 feature_id，无法回写 thickness。
- **execution.js 测试困难**：execution.js 依赖复杂的 pg pool + Brain API 调用，运行时 mock 几乎不可能完整，所以用静态代码分析（readFileSync）验证关键代码模式是否存在，这是一个务实的取舍。

### 下次预防

- [ ] 新增数据库路由时，必须写至少一个测试验证 SQL 列名与真实 schema 一致（防 `registered_at` 类 bug）
- [ ] harness 任务链新增 payload 字段时，必须在设计文档中明确列出该字段需要传播的所有位置（共 N 处），防漏传
- [ ] execution.js 类似的"很难 mock 的大文件"可以用静态代码分析测试（readFileSync + includes）作为保障，但要注意锚点字符串要足够唯一
- [ ] smoke 脚本要加 `--connect-timeout` + `--max-time`，防止 CI 因 Brain 未启动而卡死
- [ ] Skill 文件（~/.claude/skills/）改动不走 CI，需要人工验证或在 session 内直接验证文件内容
