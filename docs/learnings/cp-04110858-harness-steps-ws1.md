### 根本原因

实现 Harness Pipeline 全链路步骤详情（Backend）：`pipeline-detail` 端点新增 `steps` 数组，含每步的 input/prompt/output 数据重建。

关键设计决策：
- **分支查找策略**：任务的输出分支信息分散在不同字段（result.propose_branch / payload.planner_branch 等），需要多策略 fallback，包括从同 pipeline 的其他任务借用 planner_branch，以及按 task_id 前缀搜索 git 分支
- **prompt 重建**：复现 executor.js 的 preparePrompt 逻辑，直接构建与 AI 实际收到相同格式的 prompt 字符串（含 skill 名称前缀）
- **execSync 用于 git show**：与 executor.js 保持一致，路由层直接用 execSync 读 git 文件内容

### 下次预防

- [ ] Brain 路由中使用 git 操作时，REPO_ROOT 已在 harness.js 顶部定义（`new URL('../../../..', import.meta.url).pathname`），直接用
- [ ] 多轮 propose/review 的 round 编号优先从 `payload.propose_round` 读，不要自己计数（Brain 已经写入正确值）
- [ ] 分支搜索 `findBranchesByTaskId` 需去重（同一 task_id 在 local + remote 各有一条）
