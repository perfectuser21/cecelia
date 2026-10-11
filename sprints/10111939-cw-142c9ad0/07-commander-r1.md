# coding commander 裁决（第 1 次）

- 升级：qa_cannot_verify
- 处理：解除升级，继续自动流程
- 总结：T-2 维持规格：环境没配 token 属于 Q-2 本身允许的跳过情形；另补 S-4 单测，CI 中确定性覆盖 Q-2 的 401 鉴权分支，已提交 091be9a1e，工作区干净。
- 提交：091be9a1e

## 逐条裁决

### T-2
- 裁决：维持规格
- 理由：Q-2 原文写明预览环境没配 CECELIA_INTERNAL_TOKEN 就跳过、注明鉴权分支不可测，QA 按规格执行；本 PR 没改 internal-auth.js 和 runs 读路由的鉴权，QA 已确认请求落到 runs 读路由（run not found: stats），不是 500。规格末尾追加了「补充 S-4」：在 content-pipeline-runs-shadow.test.js 新增用例，测试内配 token，不带 token 请求 /api/brain/runs/{4 段} 返回 401 UNAUTHORIZED 且不查库，带 token 返回 404 run not found，用单测确定性覆盖 401 分支（修复前这几条会被内容流水线接走返回 500，回退能被抓到）。本地 21/21 通过。
