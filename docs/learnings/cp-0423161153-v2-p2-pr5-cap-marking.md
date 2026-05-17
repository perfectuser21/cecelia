## v2 P2 PR5 cap-marking Middleware（2026-04-23）

### 根本原因

v2 P2 第 5 PR，新增 cap-marking middleware。和 PR1-4 不同，这个 middleware **暂时不接线**到 executeInDocker —— 纯模块 + 单测。刻意选择延迟接线，把所有 middleware 的 "attempt-loop 整合" 留到一个整合 PR 一次性做。这样每个 middleware PR 都是独立的、零行为改动的新增。

更深层的认识：前 4 个 middleware 我用"搬家+接线"模式（从 docker-executor 抽出+立刻在 executeInDocker 调用），但 cap-marking 跟它们不同——原 markSpendingCap 在 execution-callback 的 post-facto 路径而不是 spawn 内。放到 spawn 里是一个**新的行为**（更早检测），所以分开做：先建模块，后整合。

### 下次预防

- [ ] **区分"搬家 PR"和"新建 PR"**：middleware 抽出有两种模式 — (A) 从已有位置搬到 middleware/（零行为改动），(B) 建立 middleware/ 里的新模块且目前无人调用（未来整合）。PR1-4 是 A，PR5 是 B。spec 写作时要明确标注是哪种模式，避免 implementer 困惑
- [ ] **spec 的"不做"列表是强约束**：PR5 spec 明说"不接线 executeInDocker"，implementer 完全遵守。code quality reviewer 特意跑 DoD 3 验证这一条——防止 implementer"顺手"接线。以后 spec 的"不做"列表要列得具体 + DoD 里加一条反向检查
- [ ] **regex 数组常量放在模块顶部**：`CAP_PATTERNS` 数组 3 个 regex 放在 cap-marking.js 顶部，方便后续 PR 加 pattern（例如 Claude Code 特殊 429、insufficient quota 等）。加新 pattern 时只动数组，不动 checkCap 函数本身
