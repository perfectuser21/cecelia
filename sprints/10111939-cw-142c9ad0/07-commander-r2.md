# coding commander 裁决（第 2 次）

- 升级：qa_cannot_verify
- 处理：解除升级，继续自动流程
- 总结：T-2 采纳：Q-2 改为不依赖预览环境 token 的做法（真实请求 401 或 404 二选一，再加 S-4 单测确认 401 分支），解开连续两轮 CANNOT_VERIFY 的升级循环；只在规格末尾追加了裁决节，提交 6e3c3a4bd，工作区干净。
- 提交：6e3c3a4bd

## 逐条裁决

### T-2
- 裁决：采纳
- 理由：Q-2 原文依赖预览 Brain 配了 CECELIA_INTERNAL_TOKEN，预览环境没配，于是两轮都记 CANNOT_VERIFY，自动流程每次都升级。第 1 次裁决只说不阻塞，没解决这个循环。Q-2 的意图（I-1）是确认 /api/brain/runs/stats 落到 runs 读路由及其鉴权中间件，不被内容流水线接走、不返回 500，这一点不配 token 也能验。规格末尾追加了「补充 Q-2」：一是真实链路请求，配了 token 时期望 401 UNAUTHORIZED，没配 token 时期望 404 run not found: stats，两种结果都只有 runs 读路由会给，出现 500/400 或内容流水线的字段就判 FAIL；二是在 PR 工作区跑 content-pipeline-runs-shadow.test.js，S-4 的 401 用例必须通过（本地 21/21 通过）。两条都满足就记 PASS，不再记 CANNOT_VERIFY。QA r2 的实测结果是 404 run not found: stats，已满足第一条。
