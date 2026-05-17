# Learning: Content Factory 批量生成 — POST /api/brain/pipelines/batch

**任务**: KR3-T2 AI 批量生成 (49aa3ce9-be29-4e9a-9332-23d04e691165)
**分支**: cp-03220808-49aa3ce9-be29-4e9a-9332-23d04e

---

### 根本原因

实现 Content Factory 批量生成接口时，遭遇两个独立的技术障碍：

**问题1**: Brain server.js 在 VITEST 环境中调用 `server.listen(5221)`，导致端口冲突 (`EADDRINUSE`)，所有需要加载 routes.js 的测试全部崩溃。

**问题2**: 3 个预存在的 callback 测试 (callback-atomic / callback-error-fields / callback-null-fallback) 在本机（Mac mini M4，RAM 有限）运行 `npm test` 时因 heap OOM 崩溃 (`FATAL ERROR: JavaScript heap out of memory`)。这些测试文件只 mock 了 15 个左右的 vi.mock，但 execution.js 有 2968 行 + 38 个动态 import + fire-and-forget Promise，导致每个 fork（3GB 限制）在加载路由时内存耗尽。

---

### 下次预防

- [ ] 新增 Brain API 路由测试前，先检查 `server.js` 是否有 `VITEST` 环境判断
- [ ] 测试文件 mock 需要覆盖 `thalamus.js` + `decision-executor.js` + `llm-caller.js` —— 这三个模块在 execution.js 中被直接调用，不 mock 会触发真实 LLM 连接导致 OOM
- [ ] 本机 `npm test` OOM 不等于 CI 失败 —— ubuntu-latest 16GB + 3 fork × 3GB = 充足余量，OOM 是本机限制而非代码问题
- [ ] 预存在测试失败应单独 commit 标注为 `fix(brain): 修复预存在测试`，与功能 commit 分开，便于追溯
- [ ] Content Pipeline 批量接口验证顺序：先校验 items 数组边界（< 2 或 > 20），再校验每项 content_type

