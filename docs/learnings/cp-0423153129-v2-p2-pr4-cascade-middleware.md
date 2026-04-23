## v2 P2 PR4 cascade Middleware（2026-04-23）

### 根本原因

v2 P2 第 4 PR，在 `spawn/middleware/` 新增 `cascade.js` 的 `resolveCascade`，修补 PR3 遗留的 gap：account-rotation 读 opts.cascade 但没人给它赋值。实现细节上本打算写成 sync（spec 原稿），但发现 `packages/brain/` 是 ESM package（"type": "module"），不能用 CommonJS `require`，所以改成 async + dynamic import。docker-executor 调用点配套加 await。code quality reviewer 挑出测试里有 1 个 test 调了 async 函数没加 await（floating Promise）— 这类 NIT 人工写 test 时经常漏，自动化的 ESLint no-floating-promises 规则能抓。

### 下次预防

- [ ] **ESM package 里 middleware 默认 async**：Cecelia `packages/brain/` 是 ESM，PR4 的 sync 设计在 review 阶段因 ESM 限制被迫改 async。后续 PR5-9 的 middleware 如果有 lazy-import 需求，直接 async 起手，不要先写 sync 再返工
- [ ] **test 写完后自动 scan floating Promise**：code quality reviewer 挑 await 这种 NIT 是 review 周期内；可以在 implementer prompt 里加硬规矩"所有 async 函数调用必须 await"，或者 plan 模板里给 test 模板直接写好 async test signature
- [ ] **spec 文档 sync/async 可以留空**：spec 本应聚焦"opts 原地改 + ctx.deps 注入"的语义约束，不要在 spec 里提前绑定 sync/async 实现细节。PR4 spec 原稿里写 "export function resolveCascade" 就是在绑定 sync 的暗示，导致 implementer 要做 judgment call。以后 spec 写 "signature: `resolveCascade(opts, ctx)` — 返回 void 或 Promise<void>，caller 要 await" 更干净
