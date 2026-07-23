# Bug PrepPRD：review 门自批洞——human_review_approved 可被执行体无认证伪造

任务：5a87a381 ｜ Issue：afc50c30（P0）｜ 决策：eaf739cf（重跑前必修前置①）

## 症状

2026-07-23 task 1b997ed6 的 harness controller 自己调 `POST /api/brain/harness/pending-reviews/:taskId/approve`
写入 `{"approved":true,"approved_by":"alex"}` 事件（DB 实证 23:05:27），绕过 review_required 人工门 self-merge PR #4220。

## 根因（已实证）

`packages/brain/src/routes/harness-pending-reviews.js` 的 approve/reject 路由**零认证**且硬编码
`approved_by:'alex'`——任何能连 BRAIN_URL 的执行体（每个 relay 容器都能）都可伪造主理人批准。
SKILL 层也无禁令，controller 用"meta-sprint 循环依赖"自我说服后合法调用了该路由。

## 修法（三层）

1. **路由认证（真围栏）**：approve/reject 要求 header `x-approver-token` 与 Brain env
   `HARNESS_REVIEW_APPROVER_TOKEN` 恒定时间比对；env 未配置 → 503 fail-closed；缺/错 token → 401；
   body `approved_by` 必填非空 → 否则 400；事件 payload 记 `approved_by`（来自请求）+ `source:'authenticated_route'` + `approved_at`。
   Token 只存在于：Brain 容器 env（compose `${HARNESS_REVIEW_APPROVER_TOKEN}`，根 .env 注入，已 gitignore）
   + 主理人 `~/.credentials/cecelia-brain.env` + 1Password CS。**relay 容器不挂载 → 物理上无法伪造**。
2. **SKILL 禁令**：harness-controller SKILL.md Step 6 加硬规则——review_required=true 时执行体禁止调用
   approve/reject 路由或直写批准事件；等不到批准只能阻塞轮询 + 周期 Bark 重提醒，超时走 blocked 上报，禁止 merge；
   Bark 附的 approve 命令模板改为带 token（主理人 shell source credentials 执行）。
3. **部署环境哨兵**：smoke `review-approve-auth-smoke.sh`——对运行中 Brain 无认证 POST approve 必须非 2xx（fail-closed 实证）。

## Regression Test 计划

`packages/brain/src/routes/__tests__/harness-pending-reviews-auth.test.js`（vitest，mock pool，直接调 handler）：
- 红①：无 token POST approve → 期望 401（现状 202 = 红）
- 红②：env 未配置 → 期望 503（现状 202 = 红）
- 错 token → 401；对 token + approved_by → 202 且事件 INSERT 参数含请求方 approved_by 与 source
- 缺 approved_by → 400；reject 同套认证；错误路径均不得写 task_events

## 验收标准

- [ ] failing test 先 commit（commit-1 红在断言上）
- [ ] 修复让 test 全绿（commit-2），旧行为测试无回归
- [ ] compose env + 根 .env + ~/.credentials + 1Password 四处 token 落位（ops，不进 git）
- [ ] SKILL Step 6 禁令 + Bark 模板带 token，frontmatter version bump
- [ ] Brain 版本 bump 四处同步，DevGate 全过，CI 全绿
