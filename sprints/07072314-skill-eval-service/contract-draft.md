# Contract Draft — Skill Evaluator 内部验收台

task_id: 52145edd-e409-4459-9490-7a02bf8e87de
sprint_dir: sprints/07072314-skill-eval-service
drafted: 2026-07-07
version: v1.1（GAN Round 2，已应用 R1 reviewer feedback）

---

## 系统边界

```
公网用户
  │ HTTPS + Basic Auth
  ▼
HK Caddy/nginx（/eval-api/）
  │ 注入 X-Eval-Proxy-Token
  ▼
Brain（localhost:5221）
  │ 验 Token → 硬校验 → hash 去重 → 建 task
  │
  ├─► skill_eval_tasks（PostgreSQL 子表）
  │
  ▼
Brain Tick（调度器）
  │ 单 slot 串行（MAX_CONCURRENT_SKILL_EVAL=1）
  ▼
docker-executor（mmv）
  │ account2 运行 skill-evaluator quick 模式
  │ 30min 超时强杀
  ▼
报告 SSH 发布 → hk-vps /data/docs/skill-evals/<短码>-<名slug>/
  │
  ├─► 更新索引页（50条分页）
  └─► report_url（Basic Auth 保护）
```

---

## FR 列表补充

> **FR14（P2）**：`GET /api/brain/quota/status` 端点，返回 `{ sonnet_5h_remaining_pct, sonnet_7d_remaining_pct, threshold_5h: 85, threshold_7d: 90, ok: bool }`。INV-03 manual:bash 依赖此端点进行手动验证。

---

## 核心约定

### C1 — 代理令牌隔离
HK Caddy 层在每个到 Brain 的请求中注入固定头 `X-Eval-Proxy-Token: <token>`。
Brain POST /api/brain/skill-evals/upload 端点在入口处验证此头：
- 缺失或值不匹配 → 立即 HTTP 403，不做任何业务处理。
- 令牌存储于 1Password CS vault + `~/.credentials/skill-eval-proxy.env`（chmod 600）。

### C2 — 上传硬校验六件套（顺序执行，任一失败即 HTTP 400）
1. zip 魔数：前 4 字节 = `50 4B 03 04`
2. 压缩后文件大小 ≤ MAX_ZIP_MB（默认 10MB）
3. 解压后总大小 ≤ 50MB 且文件数 ≤ 2000
4. 压缩比 ≤ 100:1（解压后 / zip 文件大小）
5. 必含唯一 SKILL.md（根目录下，不能有多个）
6. 无路径穿越（entry.name 不含 `..`）

### C3 — hash 去重
上传 zip 计算 SHA-256：
- 命中已 `completed` 的记录 → HTTP 200，返回 `{ "status": "duplicate", "report_url": "<历史URL>" }`
- 命中 `in_progress` / `pending` 记录 → HTTP 200，返回 `{ "status": "merged", "task_id": "<既有ID>" }`
- 无命中 → 建新 task，HTTP 201

### C4 — 单 slot 串行调度
Brain Tick 同时运行的 skill_eval 任务数 ≤ 1（`MAX_CONCURRENT_SKILL_EVAL` 环境变量，默认 1）。
pending 队列 ≥ 20 时，新上传请求返回 HTTP 429 `{ "error": "排队已满" }`，不建 task。

### C5 — 额度预检
Brain 在将 pending → running 转换前验证 Claude 额度：
- 5h Sonnet 池剩余 ≥ 85%
- 7d Sonnet 池剩余 ≥ 90%
不足任一条件 → task 保持 pending，在 `skill_eval_tasks.pending_reason` 字段写入
`"quota_insufficient: 5h=xx% 7d=xx%"` 形式的说明，同时触发飞书告警（告警线：5h<70% 或 7d<80% 时加倍告警）。

额度状态通过 `GET /api/brain/quota/status` 可查（见 FR14）。

### C6 — 超时强杀
评估进程运行超 `SKILL_EVAL_TIMEOUT`（默认 30min）→ 强杀容器 → task 状态 → `failed`（reason: timeout）→ 释放 slot → 飞书告警。

### C7 — 报告访问控制
- report_url 路径下的所有文件由 HK Caddy/nginx Basic Auth 保护。
- 不带 Authorization 头访问 report_url → HTTP 401。
- 报告 HTML 文件永久留存（不自动删除）。
- staging zip 清理：成功后 3 天，失败后 14 天。

### C8 — 飞书告警聚合
同类告警事件（同 type 字段）10min 内合并为 1 条消息。
连续失败 ≥ 3 次 → 升级告警，告警消息中携带标记 `{ escalated: true, level: 'P0' }`（JSON 结构体注入飞书消息 extra 字段）。
飞书 webhook 调用失败 → 本地日志文件兜底（`logs/feishu-fallback.jsonl`）。

### C9 — 全配置注入
以下参数必须从环境变量读取，禁止代码中写死：
`MAX_ZIP_MB`, `SKILL_EVAL_TIMEOUT`, `MAX_CONCURRENT_SKILL_EVAL`, `SKILL_EVAL_PENDING_LIMIT`,
`SKILL_EVAL_STAGING_RETENTION_SUCCESS_DAYS`, `SKILL_EVAL_STAGING_RETENTION_FAILURE_DAYS`。

### C10 — 上传页 & 轮询 UI
- `/eval-api/upload.html`：zip 拖拽、skill 名称、来源平台、归属链选择、提交人（选填）。
- 前端预校验：文件大小 ≤ MAX_ZIP_MB（从页面配置读取）。
- 轮询策略：初始 5s，×1.5 指数退避，上限 30s。
- 显示排队位次；completed → "查看报告"按钮（带 Basic Auth 弹出）。
- 错误信息：上传失败/429 排队满 → 页面红字显示服务端返回的具体 error 字段。

---

## E2E 验收

### 场景 E1 — 正常上传 & 评估完成

**Fixture 文件来源**：
`~/incoming/日报skill-v1.2-7.7.zip` 由 ZenithJoy mmv 宿主机生成。
生成步骤：在 mmv 上运行 `skill-evaluator pack --skill 日报skill --version v1.2` 输出到 `~/outgoing/`，
再通过 `scp mmv:~/outgoing/日报skill-v1.2-7.7.zip ~/incoming/` 拉取到本地。
文件含合法 `SKILL.md`（根目录唯一），解压后 < 50MB，文件数 < 2000。

**前提**：
- `~/incoming/日报skill-v1.2-7.7.zip` 已按上述步骤准备（含合法 SKILL.md，未超限）
- HK Caddy 已配置 Basic Auth + `/eval-api/` 反代
- mmv docker-executor 就绪，account2 可用

**步骤**：
1. POST `https://<hk-host>/eval-api/upload`（带 Basic Auth），上传 zip
2. 收到 HTTP 201，body 含 `task_id`
3. 每隔 ≤30s 轮询 `GET /api/brain/skill-evals/{task_id}/status`
4. 在 30min 内收到 `status: completed`，body 含 `report_url`
5. `curl -u user:pass <report_url>` → HTTP 200，正文含"功能地图"与"裁决"
6. `curl <report_url>`（不带 Auth）→ HTTP 401
7. `curl -X POST <brain-host>:5221/api/brain/skill-evals/upload`（不带 X-Eval-Proxy-Token）→ HTTP 403
8. 评估索引页出现该次评估条目

**断言**：
- 步骤 2：HTTP 201，`task_id` 为 UUID 格式
- 步骤 4：在 30min 内状态变为 `completed`
- 步骤 5：HTTP 200，`grep "功能地图"` 和 `grep "裁决"` 均命中
- 步骤 6：HTTP 401
- 步骤 7：HTTP 403
- 步骤 8：索引页 HTML 含该 task_id 或 skill_name

### 场景 E2 — hash 去重（completed）

**步骤**：上传同一 zip 第二次（E1 完成后）
**断言**：HTTP 200，`status: duplicate`，`report_url` 与 E1 相同

### 场景 E3 — 硬校验拦截

**步骤**：上传一个内容全为 `null bytes` 的文件（zip 魔数错误）
**断言**：HTTP 400，body 含具体校验失败原因

### 场景 E4 — 背压拒绝

**步骤**：构造 21 个 pending 任务后再上传新 zip
**断言**：HTTP 429，body `{ "error": "排队已满" }`

### 场景 E5 — 无 Token 直打 Brain

**步骤**：`curl -X POST http://brain:5221/api/brain/skill-evals/upload` 不带 X-Eval-Proxy-Token
**断言**：HTTP 403

---

## 非功能约束汇总

| 参数 | 值 |
|------|-----|
| MAX_ZIP_MB | 10 |
| 解压上限 | 50MB |
| 文件数上限 | 2000 |
| 压缩比上限 | 100:1 |
| 评估超时 | 30min |
| pending 上限 | 20 |
| staging 保留（成功） | 3d |
| staging 保留（失败） | 14d |
| 额度预检阈值 5h | ≥85% |
| 额度预检阈值 7d | ≥90% |
| 飞书聚合窗口 | 10min |
| 连败升级阈值 | ≥3 次 |
| 索引页分页 | 50条/页 |
