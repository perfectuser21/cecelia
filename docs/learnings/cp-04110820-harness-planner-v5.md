### 根本原因

harness-planner SKILL.md v4.1 的 Step 0 只读代码文件，缺乏业务上下文采集能力（不调 Brain API），PRD 模板也缺少结构化章节（User Stories/GWT/FR-SC/假设/边界/OKR 对齐），导致 Planner 产出的 PRD 无法与 OKR 对齐，歧义消解能力弱。

### 下次预防

- [ ] Planner Step 0 必须先调 `curl localhost:5221/api/brain/context` 建立业务上下文，再探索代码（两者分离，不混用）
- [ ] PRD 模板需包含 OKR 对齐章节（KR 编号 + 当前进度 + 预期推进），确保每个 Sprint 都有明确的 KR 归属
- [ ] 9 类歧义自检是 PRD 质量的前置门禁，无法推断的项一律用 `[ASSUMPTION: ...]` 记录，不猜测不询问（除非影响方向决策）
