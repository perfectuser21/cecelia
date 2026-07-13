# Design: skill-evaluator Form B 渲染器折回 + 评估 worker（Track 2）

## 背景
Track 1（skill-evaluator 出 report_data，PR #115）已合并。cecelia 侧 `routes/eval.js` 已有完整
upload/status/report/complete 四端点与 `skill_evals` 表，但渲染器仍是旧版"解剖图"，评估流程需人工手跑。
本次折回定稿渲染器、补齐评估 worker，让上传 zip → 拿到报告的链路本地可跑通。

## 范围
1. `packages/brain/src/skill-eval-report-render.js` 整体替换为
   `~/perfect21/skill-eval-formb-assets/render.mjs`（n8n 连线图渲染器）。
   导出接口维持 `renderReportHtml(reportData)` / `renderReportBody(reportData)` /
   `renderComparePage(items)` 不变（`routes/eval.js` 只依赖 `renderReportHtml`，其余两个是导出面保留）。
2. `packages/brain/src/skill-eval-report-schema.js` 的 `validateReportData` 替换为 render.mjs
   内的版本 —— 同时接受新 `anatomy.pipeline` 结构和旧 `anatomy.{inputs,kernel,outputs}` 结构
   （字段存在哪个就按哪个校验，不强制二选一报错）。
3. 更新 `packages/brain/src/__tests__/skill-eval-report-render.test.js` 与
   `skill-eval-report-schema.test.js`：改用 `report_data8-real.json`（全部前置）和
   `report_interleaved-example.json`（穿插判定）两份真实 fixture 断言渲染产物含关键结构
   （不做 fallback，即 `validateReportData` 必须对这两份数据返回 valid）。
4. 新增 `packages/brain/scripts/skill-eval-worker.js`：单次轮询脚本（非常驻 daemon，本 PR 范围内
   验证"能跑通"，常驻部署留到 PR merge 后）：
   - 查 `skill_evals WHERE status='pending' ORDER BY created_at LIMIT 1`
   - 解压 `staging_path`（zip）到临时目录
   - 拼 `eval-prompt.txt` + skill 目录路径，`spawn` 本地 `claude` 二进制：
     `CLAUDE_CONFIG_DIR=/Users/administrator/.claude-account2 claude -p "<prompt>" --model sonnet --output-format json`
   - 解析 stdout 中的 JSON；若 `JSON.parse` 失败，用兜底正则清理内部未转义双引号后重试一次
   - 成功 → `POST /api/skill-eval/complete`（header `X-Eval-Proxy-Token: $EVAL_PROXY_TOKEN`），
     body `{task_id, report_url, report_data}`；`report_url` 由 `BRAIN_BASE_URL` 拼
     `/api/skill-eval/report/<task_id>`
   - 失败 → 更新 `skill_evals.status='failed'`, `failure_reason`（直接写库，不经 HTTP，因为
     `/complete` 端点当前只处理成功路径）

## 不做（本 PR 范围外）
- mmv 常驻进程化（pm2/systemd）—— PR merge 后单独执行，不产生 git diff
- HK `/eval-api` 反代配置 —— 同上
- 前端上传页改动（已存在，不动）

## 测试策略
- unit：render/schema 现有测试文件改用真实 fixture 断言（非 mock）
- worker：本地跑一次 `node skill-eval-worker.js` 对一个真实 staging zip，验证
  `skill_evals.status` 从 pending → completed，`report_data` 落库且能被 `renderReportHtml` 正常渲染
- CI：不新增 CI job（worker 依赖 `claude` 二进制和真实 API key，非 CI 可跑范围），worker 正确性由本地
  跑通 + 上面的 unit test 兜底

## 风险
- render.mjs 是独立脚本迁移进 monorepo 需要确认无 Node 版本特性冲突（`with { type: 'json' }` 等）——
  cecelia 侧 Node 版本需核对，若不支持则 worker 里换用 `fs.readFileSync` + `JSON.parse` 读 fixture
  （生产路径不依赖 import json，只有测试 fixture 可能用到，可绕开）
