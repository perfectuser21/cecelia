# Sprint PRD — ZenithJoy 运营中枢 Skill Evaluator 内部验收台（thin 贯穿）

## OKR 对齐

- **对应 KR**：ZenithJoy 运营中枢 Line 00 能力闭环
- **当前进度**：Dashboard 状态矩阵 ✅、9平台 Session 健康 ✅，Skill Evaluator 台待建
- **本次推进预期**：thin 贯穿"员工上传 zip → 无头评估 → 公网报告"最小闭环

## 背景

员工把在 Codex/ChatGPT/Claude 上做的 skill 打成 zip，需要一个内部渠道提交评估、拿到验收报告，全程不碰 Claude Code。当前缺：Brain task_type=skill_eval、上传端点、单 slot 队列执行、报告发布、HK 反代、最小上传页。本 sprint 实现 thin 最小闭环，强化项（FR38-FR53）留后续 Run 加厚。

## Golden Path（核心场景）

员工从 [访问评估页 Basic Auth 通过] → 经过 [上传 zip → 建队列 → 容器评估 → SSH 发布报告] → 到达 [员工拿到公网可访问的验收报告链接]

具体：
1. 员工访问 `https://docs.zenjoymedia.media/eval` → Basic Auth 通过 → 看到上传表单（zip 拖拽 + skill 名称 + 来源平台 + 归属线选择 + 选填提交人）
2. 前端预校验（.zip 扩展 + 大小 ≤ MAX_ZIP_MB=10MB + 必填齐）→ POST 同源 `/eval-api/upload` → 页面显示"已进队列，前面还有 N 个" + task_id
3. HK Caddy 验 Basic Auth → 注入 `X-Eval-Proxy-Token` → 转发 Brain `/api/eval/upload`；Brain 验令牌（403 拒非法）→ 硬校验（zip 魔数/解压 ≤50MB/压缩比 ≤100:1/必含唯一 SKILL.md/路径穿越拦截）→ hash 去重（命中 completed → 返回历史 report_url；命中 in_progress → 合流返回既有 task_id）→ zip 落 staging → 建 task_type=skill_eval
4. Brain tick 单 slot 串行（MAX_CONCURRENT_SKILL_EVAL=1；pending ≥20 → 拒新返"排队已满"）→ 额度预检（account2 5h 池 ≥85% + 7d 池 ≥90%，不满足 → 飞书告警 + task pending 保留）→ docker-executor 起容器（CECELIA_CREDENTIALS=account2，`claude -p --model sonnet`）→ 容器内调 skill-evaluator quick 模式（无头向导保守替判）
5. 评估完成 → 报告 SSH 发布 HK `/data/docs/skill-evals/<task短码>-<名slug>/` → 追加评估索引页条目 → 回写 report_url 置 task completed
6. 员工页面轮询（5s 起 ×1.5 指数退避封顶 30s）→ 状态变 completed → 显示"查看报告"链接 → 点开验收报告（功能地图第一屏 + 裁决 + 缺陷清单）
7. 员工日后可凭评估索引页或 task_id 找回历史报告

出错恢复：
- 上传校验失败 → 页面红字具体原因（如"缺少 SKILL.md""超过 50MB"），不建 task
- account2 额度不足/登录态失效 → 派发前拦截，task pending 保留，飞书告警；员工侧显示"评估排队中（系统维护）"
- 容器起不来 `failed(dispatch)` / 会话崩溃 `failed(crash)` / 超 SKILL_EVAL_TIMEOUT=30min `failed(timeout)` / SSH 发布失败 `failed(publish)` → 统一释放 slot + 飞书告警（10min 同类聚合）→ 员工侧显示"评估失败：<阶段>，可重新提交"
- HK→US 链路抖动 → 轮询侧显示"连接中断，任务仍在运行"（不误判失败）；发布侧进重试队列
- 飞书 webhook 挂 → 本地日志兜底

## 边界情况

- 上传非 .zip / 超 10MB / 缺必填 → 前端拦截，不到达后端
- zip 魔数不符 / 解压超 50MB / 压缩比超 100:1 / 路径穿越 → 后端 422 + 具体错误描述
- 同一 zip hash 命中 completed → 直接返回历史 report_url，不重跑
- 不带 X-Eval-Proxy-Token 直打 Brain 端点 → 403
- 不带 Basic Auth 请求 docs 域 → 401
- pending ≥20 → 新上传 429（"排队已满，请稍后重试"），不建 task
- 报告 URL 不带 Basic Auth 访问 → 401（受 Basic Auth 保护）

## 范围限定

**在范围内**：
- Brain 新增 task_type=skill_eval + `/api/eval/upload` 端点 + `/api/eval/status/:task_id` 端点
- Brain tick 单 slot 调度逻辑（MAX_CONCURRENT_SKILL_EVAL=1）+ 额度预检 + 飞书告警
- docker-executor 调用 skill-evaluator quick 模式（账号 account2）
- 报告 SSH 发布 HK + 评估索引页追加
- HK Caddy/nginx 反代配置（`/eval-api/` location + X-Eval-Proxy-Token 注入）
- 最小上传页（Basic Auth 保护，ZIP 拖拽 + 三个字段 + 轮询状态展示）
- staging 清理策略（成功 3 天 / 失败 14 天）
- 单元测试覆盖硬校验 + 去重 + 槽位逻辑

**不在范围内**：
- FR38-FR53 强化项（slug 净化细节/GBK 容忍/多 skill 判非法/索引分页/发布前扫密/slot 租约 TTL/Brain 重启对账/上传幂等键/staging 保护 running/UTC 统一）
- full 模式评估
- 失败自动重试
- 个人账号体系 / 历史列表高级筛选
- 跨模型对比

## 假设

- [ASSUMPTION: skill-evaluator quick 模式调用接口与 zenithjoy-skills #103 的 eval 方式一致，Generator 需先确认容器内调用方式]
- [ASSUMPTION: HK docs.zenjoymedia.media 的 Basic Auth 凭据已存 1Password CS "ZenithJoy 文档中心 (HK docs)"，实施时直接取用]
- [ASSUMPTION: X-Eval-Proxy-Token 实施时由 Generator 生成并写入 1Password CS + ~/.credentials/，不硬编码]
- [ASSUMPTION: HK→US Tailscale IP 以实施时 `tailscale status` 为准，禁止写死]
- [ASSUMPTION: ~/incoming/日报skill-v1.2-7.7.zip 为 E2E fixture，已知评估结果可比对]
- [ASSUMPTION: mmv 为生产派发宿主，docker ✅]

## 预期受影响文件

- `packages/brain/src/routes/eval.js`：新增（upload + status 端点）
- `packages/brain/src/tick.js`：skill_eval 单 slot 调度分支
- `packages/brain/src/docker-executor.js`：skill_eval task_type 分支（account2 + skill-evaluator quick）
- `packages/brain/src/feishu-alert.js`（或新增）：skill_eval 失败聚合告警
- `packages/brain/src/__tests__/eval.test.js`：新增（硬校验 + 去重 + 槽位 + 额度预检）
- `scripts/publish-skill-eval-report.sh`：新增（SSH 发布 + 索引追加）
- HK Caddy/nginx 配置（`/eval-api/` location 及 X-Eval-Proxy-Token 注入）
- `apps/eval-upload/`（或独立 HTML）：最小上传页

## NFR 约束

<!-- 来源: PrepPRD 显式拍板值，全部通过环境变量注入，禁止写死 -->
- 上传限制: MAX_ZIP_MB=10（前端+后端双校验）；解压 ≤50MB；压缩比 ≤100:1（文件数 ≤2000）
- 超时: SKILL_EVAL_TIMEOUT=30min（超时标 failed(timeout) 释放 slot）
- 背压: pending ≥20 → 拒新（HTTP 429）
- 并发: MAX_CONCURRENT_SKILL_EVAL=1（单 slot 串行）
- 轮询: 5s 起 ×1.5 指数退避，封顶 30s
- 清理: staging 成功 3 天 / 失败 14 天自动清理；报告永久留存
- 索引: 最近 50 条分页（本 sprint thin，不实现高级筛选）
- 额度预检: account2 5h 池 ≥85% + 7d 池 ≥90% 才派发；告警线 70%/80%
- 飞书: 10min 同类聚合；连败 ≥3 升级告警
- 鉴权: 每个端点必须有 auth（Brain 端点 X-Eval-Proxy-Token；docs 域 Basic Auth）
- 可观测最小集: evals 表一行 / 队列深度 / 超时计数 / 拒绝计数 / 水位快照 / 失败明细

## Invariant 约束（铁律，proposer/evaluator 不得违反）

<!-- 来源: decisions category=invariant，area 级铁律 -->
- [单slot串行] MAX_CONCURRENT_SKILL_EVAL=1 通过环境变量注入；同时只允许一个 skill_eval task 在跑，不得写死数值
- [禁写死环境假设] HK IP / Tailscale 地址 / 端口 / 账号路径等禁止写死，必须从环境变量或运行时推导
- [真环境验证才算done] E2E 必须真实上传 zip 走公网端点，容器真实执行 skill-evaluator，报告真实可访问
- [凭据安全] X-Eval-Proxy-Token / Basic Auth / account2 凭据不硬编码、不进 git、不进日志；secrets 仅通过 ~/.credentials/ 或环境变量注入
- [日志脱敏] zip 内容 / skill 源码 / 评估中间输出不得明文进日志
- [端点鉴权] Brain `/api/eval/upload` 必须校验 X-Eval-Proxy-Token（403 拒非法）；docs 域 Basic Auth 必须覆盖评估报告路径（401 拒非法）
- [去重幂等] 同一 zip hash 命中 completed 直接返回历史 report_url，不重复跑评估
- [失败释放slot] 任何失败路径（dispatch/crash/timeout/publish）必须无条件释放 slot，不能让 slot 永久占用

## 累积 FR（本 line 已验收行为，本 sprint 不得回退/重复）

<!-- 来源: Line 00 ZenithJoy 运营中枢已完成 ability -->
- Dashboard 运营中枢状态矩阵：Dashboard 首页可展示各平台运营状态（已 done）
- 9平台+3API Session 健康全覆盖：Session 健康检查覆盖 9 个内容平台 + 3 个 API（已 done）

## E2E 验收

> Planner 初稿此区块留占位。最终可执行 E2E 脚本由 proposer 在 GAN 阶段产出（target_environment=windows_cloud → GitHub Actions windows-latest）。

```bash
# 占位：proposer 将按 target_environment=windows_cloud 填入真实脚本
# 期望验收点（自然语言）：
# 1. 真实上传 ~/incoming/日报skill-v1.2-7.7.zip 走公网 /eval-api/upload 带 Basic Auth → 返回 task_id
# 2. 轮询 /api/eval/status/:task_id 至 completed（≤30min）
# 3. curl report_url 返回 HTTP 200 且正文同时含"功能地图"与"裁决"
# 4. 同一 report_url 不带 Basic Auth 请求 → 401
# 5. 不带 X-Eval-Proxy-Token 直打 Brain /api/eval/upload → 403
# 6. 评估索引页出现该次评估条目（含 task_id 或 skill 名称）
# 7. CI 全绿
```

## journey_type: user_facing
## journey_type_reason: 涉及员工操作的最小上传页（HTML + 表单）+ 公网报告访问，需浏览器端验证
## target_environment: windows_cloud
## target_environment_reason: ZenithJoy 产品走 windows_cloud（GitHub Actions windows-latest runner），真公网端点 E2E 验证
## journey_id: Line 00（ZenithJoy 运营中枢）
## step_id: Skill Evaluator 内部验收台 — thin 贯穿首 Run
