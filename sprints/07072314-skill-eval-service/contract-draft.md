# Sprint 合同：Skill Evaluator 内部验收台（形态B）thin 贯穿

task_id: 52145edd-e409-4459-9490-7a02bf8e87de
propose_round: 1
propose_branch: cp-harness-propose-r1-52145edd

---

## Response Schema

### POST /api/eval/upload

**成功（200）**

```json
{
  "task_id": "uuid-v4",
  "position": 2,
  "status": "queued",
  "dedup": false
}
```

- `task_id`：全局唯一 UUID（`tasks.id`）
- `position`：当前排队位次（pending 任务数 + 1，0 表示立即执行）
- `status`：`"queued"` 或 `"in_progress"`（去重命中进行中任务时）
- `dedup`：`true` 表示 SHA256 命中历史 completed 任务，此时额外返回 `report_url`

**去重命中 completed（200）**

```json
{
  "task_id": "existing-uuid",
  "position": 0,
  "status": "completed",
  "dedup": true,
  "report_url": "https://docs.zenjoymedia.media/skill-evals/abc123-rishi-skill/report.html"
}
```

**鉴权失败（403）**

```json
{ "error": "forbidden", "message": "Missing or invalid X-Eval-Proxy-Token" }
```

**校验失败（422）**

```json
{
  "error": "validation_failed",
  "stage": "zip_magic_check",
  "message": "文件不是有效 ZIP（magic bytes 校验失败）"
}
```

`stage` 枚举：`zip_magic_check` | `decompressed_size` | `compression_ratio` | `skill_md_missing` | `path_traversal` | `file_count_limit`

**队列已满（429）**

```json
{ "error": "queue_full", "message": "排队已满（pending≥20），请稍后重试" }
```

---

### GET /api/eval/tasks/:id

**成功（200）**

```json
{
  "task_id": "uuid-v4",
  "status": "in_progress",
  "skill_name": "日报skill",
  "platform": "claude",
  "line": "Line00",
  "submitted_by": "alex",
  "position": 0,
  "report_url": null,
  "failure_stage": null,
  "created_at": "2026-07-07T12:00:00.000Z",
  "updated_at": "2026-07-07T12:05:00.000Z"
}
```

- `status`：`queued` | `in_progress` | `completed` | `failed(zip_validate)` | `failed(credit_check)` | `failed(docker_run)` | `failed(ssh_publish)` | `failed(index_append)`
- `report_url`：completed 时填入 HK 报告 URL，其余为 `null`
- `failure_stage`：failed 时填入失败阶段标识，其余为 `null`
- `position`：queued 时为排队位次，其他状态为 0

**不存在（404）**

```json
{ "error": "not_found", "message": "task 不存在" }
```

---

## 接缝清单

### 接缝 A：HK Caddy 反向代理

- **位置**：HK 服务器 Caddy 配置，`location /eval-api/`
- **职责**：
  1. 验证 Basic Auth（`DOCS_BASIC_AUTH` 环境变量配置的用户名:密码）
  2. 注入请求头 `X-Eval-Proxy-Token: $EVAL_PROXY_TOKEN`（不暴露给员工）
  3. 将 `/eval-api/upload` 转发至 `Brain POST /api/eval/upload`
- **接缝断言**：
  - 无 Basic Auth → Caddy 返回 `401`，不透传至 Brain
  - 带 Basic Auth 但无 `X-Eval-Proxy-Token`，直接打 Brain `POST /api/eval/upload` → Brain 返回 `403`
  - Caddy 注入令牌后转发 → Brain 返回 `200` 或 `422`（视 zip 是否合法）
- **测试方式**：`curl -u user:pass https://docs.zenjoymedia.media/eval-api/upload`

### 接缝 B：docker-executor（容器内评估执行）

- **位置**：`/workspace/packages/brain/src/docker-executor.js`
- **职责**：
  1. 以 `account2` 身份在容器内执行 `claude -p --model sonnet` + skill-evaluator quick 模式
  2. 超时控制（`SKILL_EVAL_TIMEOUT=30min`）
  3. stdout/stderr 回传至 Brain；OOM/超时 → 抛错误供 Brain 处理
- **接缝断言**：
  - `task_type=skill_eval` 时，executor 使用 `account2`（不使用 primary account）
  - 超时 30min → 容器强杀 + Brain 标记 `failed(docker_run)` + 飞书告警
  - 容器退出码非 0 → Brain 标记 `failed(docker_run)` + 释放 slot
- **测试方式**：mock docker-executor 注入，验证 `account2` 选择逻辑 + 超时逻辑

### 接缝 C：SSH 发布 HK 报告 + 索引追加

- **位置**：Brain tick 评估完成后的发布步骤
- **职责**：
  1. `scp` 或 `rsync` 将报告目录发布至 HK `/data/docs/skill-evals/<task短码>-<名slug>/`
  2. 追加条目至 HK `index.html`（`<task_id>|skill_name|completed_at|report_url` 格式）
  3. Brain 回写 `report_url` + `status=completed`
- **接缝断言**：
  - SSH 连接失败 → Brain 标记 `failed(ssh_publish)` + 飞书告警（不标 completed）
  - 索引追加失败 → Brain 标记 `failed(index_append)` + 飞书告警
  - 发布成功 → `report_url` 字段非空 + 状态为 `completed`
- **测试方式**：mock SSH 客户端，验证目标路径 + 索引条目格式

---

## Golden Path（7步）

| 步骤 | 动作 | 判定点 |
|------|------|--------|
| 1 | 员工访问 `https://docs.zenjoymedia.media/skill-eval/` | 判定：HTTP 200 + 页面含上传表单元素（`<input type="file">`）；无 Basic Auth 时返回 401 |
| 2 | 员工选择合法 zip（≤10MB，含 SKILL.md）+ 填写 skill_name/platform/line → 提交 | 判定：前端预校验通过，页面显示"已进队列，前面还有 N 个" + task_id；POST `/eval-api/upload` 返回 200 含 `task_id` 和 `position` |
| 3 | HK Caddy 注入 X-Eval-Proxy-Token → Brain 收到请求，执行硬校验 + hash 去重 + 建 task | 判定：`tasks` 表出现新行（`task_type=skill_eval`，`status=queued`）；全程无 403/422 |
| 4 | Brain tick 取到 skill_eval 任务，额度预检通过 → docker-executor 以 account2 跑评估 | 判定：任务状态变为 `in_progress`；容器启动（docker ps 可见）；account2 额度未超线（5h<85% / 7d<90%） |
| 5 | 容器执行 skill-evaluator quick 模式完成 → Brain SSH 发布报告至 HK + 追加索引 | 判定：HK `/data/docs/skill-evals/<slug>/report.html` 文件存在；`index.html` 含该 task_id 条目；Brain `report_url` 字段非空 |
| 6 | 前端轮询至 `completed` → 显示"查看报告"按钮 | 判定：`GET /api/eval/tasks/:id` 返回 `status=completed` + `report_url` 非空；页面出现"查看报告"按钮 |
| 7 | 员工点开报告 + 访问索引页 | 判定：报告页 HTTP 200 且含"功能地图"与"裁决"文本；`/skill-eval/index.html` 出现该 task_id 条目；无 Basic Auth 访问报告返回 401 |

---

## 判定点登记表

| 判定点 ID | 检查项 | 期望值 | 检查命令/方式 |
|-----------|--------|--------|--------------|
| DP-01 | zip 魔数 | 前4字节 = `50 4B 03 04` | `xxd file.zip \| head -1` |
| DP-02 | zip SHA256 去重 | 相同内容二次上传返回历史 `task_id` | 上传同一文件两次，比较 task_id |
| DP-03 | DB slot count | `skill_eval` 并发 ≤ 1 | `SELECT COUNT(*) FROM tasks WHERE task_type='skill_eval' AND status='in_progress'` ≤ 1 |
| DP-04 | 账号预检（5h额度） | 5h 使用 < 85% | `GET /api/brain/agent-credit?account=account2` → `.usage_5h_pct < 85` |
| DP-05 | 账号预检（7d额度） | 7d 使用 < 90% | `GET /api/brain/agent-credit?account=account2` → `.usage_7d_pct < 90` |
| DP-06 | 解压体积上限 | 解压后 ≤ 50MB | Brain 侧检查（不依赖客户端声明） |
| DP-07 | 压缩比上限 | ≤ 100:1 | `decompressed_size / compressed_size ≤ 100` |
| DP-08 | SKILL.md 存在 | zip 内有且仅有一个 `SKILL.md` | Brain 解析 zip central directory |
| DP-09 | 路径穿越拦截 | 含 `../` 路径的 zip → 422 | 上传含路径穿越条目的 zip |
| DP-10 | 背压阈值 | pending≥20 → 429 | 并发建20个 queued 任务后上传 |

---

## 失败语义声明

| 失败类型 | 触发条件 | 状态标记 | slot 释放 | 飞书告警 |
|---------|---------|---------|-----------|---------|
| `failed(zip_validate)` | zip 魔数/解压/比率/SKILL.md/路径穿越校验失败 | `status=failed`，`failure_stage=zip_validate` | 不适用（尚未占用 slot） | 无（用户输入错误，非系统故障） |
| `failed(credit_check)` | account2 额度超线（5h≥85% 或 7d≥90%） | `status=failed`，`failure_stage=credit_check` | 不适用（尚未占用 slot） | 是（额度超线告警） |
| `failed(docker_run)` | 容器启动失败 / 超时 30min / 退出码非 0 | `status=failed`，`failure_stage=docker_run` | 是（立即释放） | 是（聚合 10min，连败≥3 升级） |
| `failed(ssh_publish)` | SSH 连接 HK 失败 / scp/rsync 失败 | `status=failed`，`failure_stage=ssh_publish` | 是（立即释放） | 是 |
| `failed(index_append)` | 索引页追加写入失败 | `status=failed`，`failure_stage=index_append` | 是（立即释放） | 是 |

---

## 输入对抗面

### 字段：zip（文件本体）

| 攻击向量 | 期望行为 |
|---------|---------|
| 非 ZIP 文件（PNG/PDF 改后缀） | 422，`stage=zip_magic_check` |
| ZIP bomb（10KB → 解压 >50MB） | 422，`stage=decompressed_size` |
| 压缩比 >100:1 | 422，`stage=compression_ratio` |
| 缺少 SKILL.md | 422，`stage=skill_md_missing` |
| 含路径穿越条目（`../etc/passwd`） | 422，`stage=path_traversal` |
| 超过 2000 个文件 | 422，`stage=file_count_limit` |
| 超过 10MB | 前端预拦截；若绕过前端，Caddy/Brain 侧拒绝（413 或 422） |

### 字段：skill_name

| 攻击向量 | 期望行为 |
|---------|---------|
| 空字符串 | 422，message 含 "skill_name 不能为空" |
| 超过 200 字符 | 422，message 含 "skill_name 过长" |
| 含 Shell 注入字符（`; rm -rf /`） | slug 净化（本 Sprint 不在范围，当前截断或拒绝） |
| Unicode 非 BMP 字符 | 正常接受（slug 生成截断至 ASCII+中文可打印字符） |

### 字段：platform

| 攻击向量 | 期望行为 |
|---------|---------|
| 非枚举值（`unknown_platform`） | 422，message 含 "platform 不合法" |
| 空字符串 | 422，message 含 "platform 不能为空" |

合法枚举（本 Sprint）：`claude`

### 字段：token（X-Eval-Proxy-Token）

| 攻击向量 | 期望行为 |
|---------|---------|
| 无请求头 | 403，`error=forbidden` |
| 令牌值错误（random string） | 403，`error=forbidden` |
| 令牌正确但过 Caddy 重放（直打 Brain） | Brain 无法区分来源（HK VPN/firewall 保护），仅验令牌 |

---

## 八要素 Checklist

- [x] **Input Schema 明确**：POST /api/eval/upload 输入字段（file/skill_name/platform/line/submitted_by）、类型、约束均已定义
- [x] **Output Schema 明确**：成功/去重/鉴权失败/校验失败/队列满的响应结构均已定义
- [x] **接缝完整**：HK Caddy / docker-executor / SSH发布 三条接缝均有断言和测试方式
- [x] **失败语义完整**：5种 failed(*) 类型含触发条件、状态标记、slot 释放、飞书告警
- [x] **Golden Path 可验**：7步每步均有可机器验证的判定点
- [x] **对抗面覆盖**：zip/skill_name/platform/token 4个字段的主要攻击向量均已列举
- [x] **NFR 可测**：MAX_CONCURRENT_SKILL_EVAL=1（DP-03）/ 额度预检（DP-04/05）/ 背压（DP-10）均有具体断言
- [x] **E2E 验收完整**：含完整 bash 脚本，6项检查覆盖上传/轮询/报告内容/401/403/索引条目

---

## E2E 验收

```bash
#!/usr/bin/env bash
# E2E 验收脚本：Skill Evaluator 内部验收台（thin 贯穿）
# 环境变量：DOCS_BASIC_AUTH（user:pass）、EVAL_FIXTURE_ZIP（本地 zip 路径）
set -euo pipefail

BRAIN="http://host.docker.internal:5221"
DOCS_BASE="https://docs.zenjoymedia.media"
ZIP_PATH="${EVAL_FIXTURE_ZIP:-$HOME/incoming/日报skill-v1.2-7.7.zip}"
BASIC_AUTH="${DOCS_BASIC_AUTH:?需设置 DOCS_BASIC_AUTH=user:pass}"

echo "=== E2E CHECK 1: 上传（公网，带 Basic Auth）→ 返回 task_id ==="
UPLOAD_RESP=$(curl -sf -u "$BASIC_AUTH" \
  -F "file=@$ZIP_PATH" \
  -F "skill_name=日报skill" \
  -F "platform=claude" \
  -F "line=Line00" \
  "${DOCS_BASE}/eval-api/upload")
TASK_ID=$(echo "$UPLOAD_RESP" | jq -r '.task_id')
POSITION=$(echo "$UPLOAD_RESP" | jq -r '.position')
echo "task_id=$TASK_ID  position=$POSITION"
[ -n "$TASK_ID" ] && [ "$TASK_ID" != "null" ] && echo "PASS:upload-task_id" || { echo "FAIL:upload-task_id"; exit 1; }
[ -n "$POSITION" ] && echo "PASS:upload-position" || echo "WARN:upload-position-null"

echo "=== E2E CHECK 2: 轮询至 completed（≤30min）==="
STATUS=""
WAIT=5
DEADLINE=$(($(date +%s) + 1800))
until [ "$STATUS" = "completed" ]; do
  sleep "$WAIT"
  NOW=$(date +%s)
  [ "$NOW" -gt "$DEADLINE" ] && { echo "FAIL:timeout-30min"; exit 1; }
  WAIT=$(python3 -c "print(min(int($WAIT*1.5),30))")
  RESP=$(curl -sf "${BRAIN}/api/eval/tasks/${TASK_ID}")
  STATUS=$(echo "$RESP" | jq -r '.status')
  echo "  status=$STATUS wait=${WAIT}s"
done
REPORT_URL=$(curl -sf "${BRAIN}/api/eval/tasks/${TASK_ID}" | jq -r '.report_url')
echo "report_url=$REPORT_URL"
echo "PASS:poll-completed"

echo "=== E2E CHECK 3: report_url 返回 200 且含「功能地图」与「裁决」==="
BODY=$(curl -sf -u "$BASIC_AUTH" "$REPORT_URL")
echo "$BODY" | grep -q "功能地图" && echo "PASS:report-功能地图" || { echo "FAIL:report-功能地图"; exit 1; }
echo "$BODY" | grep -q "裁决" && echo "PASS:report-裁决" || { echo "FAIL:report-裁决"; exit 1; }

echo "=== E2E CHECK 4: 不带 Basic Auth 访问报告 → 必须 401 ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPORT_URL")
[ "$CODE" = "401" ] && echo "PASS:auth-report-401" || { echo "FAIL:auth-report-401 (got $CODE)"; exit 1; }

echo "=== E2E CHECK 5: 不带 X-Eval-Proxy-Token 直打 Brain 上传端点 → 403 ==="
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -F "file=@$ZIP_PATH" \
  "${BRAIN}/api/eval/upload")
[ "$CODE" = "403" ] && echo "PASS:no-token-403" || { echo "FAIL:no-token-403 (got $CODE)"; exit 1; }

echo "=== E2E CHECK 6: 评估索引页出现该次条目 ==="
curl -sf -u "$BASIC_AUTH" "${DOCS_BASE}/skill-eval/index.html" \
  | grep -q "$TASK_ID" && echo "PASS:index-entry" || { echo "FAIL:index-entry"; exit 1; }

echo ""
echo "=============================="
echo "E2E 全部 6 项 PASS"
echo "task_id: $TASK_ID"
echo "report_url: $REPORT_URL"
echo "=============================="
```

---

## Test Contract

| WS | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| WS1 | `tests/skill-eval.test.ts` | 无令牌/task_id/tasks/:id/status | 路由不存在时返回404，token缺失返回403 |
