## Consciousness Tick Runtime + HTTP E2E Integration Tests（2026-04-20）

PR: #2470
分支: cp-0420152816-consciousness-e2e-tests
前置: PR #2447/#2457/#2464（三阶段 consciousness toggle 已合并）

### 根本原因

前三个 PR 已有 42 + 6 = 48 tests，但两类端到端链路没被覆盖：

1. **Tick runtime**：源码级静态断言（"代码里每个意识调用前 50 行必有 guard"）**不等同于** 运行时断言（"实际执行 tick 时意识模块真的 0 调用"）。静态断言只证明**代码路径对**，不证明**运行时行为对**。
2. **HTTP 链路**：routes 单测用 mock pool 过了，没证明 GET → PATCH → GET 在真实 Express + Postgres 下能端到端通。PR #2457 的 `value_json` bug 就是"单元绿 + 真 PG 挂"的经典案例。

本 PR 用真 executeTick 触发一轮、mock 20+ 重依赖，加上 supertest makeApp 范式的 fetch 链，补齐两个盲区。

### 下次预防

- [ ] **有一条评估维度叫"静态 vs 运行时"**：静态分析（ESLint / 源码 regex 断言）只能防"代码层面错写"，防不了"运行时行为漂移"。跨模块状态传递（cache / memory / DB）一定要有运行时 integration test 跟上
- [ ] **executeTick 这类"入口函数"要导出**：让它能被 integration test 直接调而不必起整个 Brain。`tick.js:3548` 已经 export 了，这是好实践。新增主流程函数时也照样做
- [ ] **mock 重依赖的清单管理**：Tick runtime test 共 mock 了 13 个意识模块 + 5 个重依赖 = 总计 18 处 `vi.mock`。这种 mock 墙难维护，实际上反映出 **tick.js 的耦合度过高**（直接 import 60+ 个模块）。未来考虑把 tick 重构成更薄的 orchestrator（调 registered handlers 而非硬 import），integration test 写起来会轻很多
- [ ] **supertest + makeApp 代替真端口 Playwright**：对于"前端点按钮 → 后端状态变"的验证，supertest 已经覆盖了 "HTTP 入口 → DB 落盘 → cache write-through" 的核心断言链。真浏览器 E2E 的增量价值（CSS 渲染、Service Worker 缓存、JS 运行时错误）在纯 API 层功能上几乎为 0，除非出过真浏览器层 bug 才值得上 Playwright
- [ ] **Pre-existing drift 处理预期值**：每个 PR 推送时要做好"main 上已有 version/schema drift"的准备（其它并发 PR 合并遗留）。facts-check / check-version-sync 要顺手修，不要回避。这是 cecelia monorepo 多并发 PR 场景的常态
- [ ] **源码 bug 不在 test 范围内顺带修**：本 PR Task 1 测试中发现 tick.js:3216 有 `dailyReviewResult` 未定义（PR #866 引入的 2 年老 bug），但这不在测试范围内。用 try/catch 吞掉继续跑 test 是**短期权宜**，长期应该单独开 PR 修；不要把 test 文件变成 bug 的永久兜底处。已在 Task 1 commit message 里 flag 这个 pre-existing bug
