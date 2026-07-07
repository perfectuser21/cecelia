# Contract Draft — Skill Evaluator 内部验收台（thin 贯穿首 Run）

**Sprint 目录**：`/workspace/sprints/07072314-skill-eval-service/`
**关联 Journey**：Line 00（ZenithJoy 运营中枢）
**关联 Step**：Skill Evaluator 内部验收台 — thin 贯穿首 Run
**目标环境**：windows_cloud（GitHub Actions windows-latest）
**合同状态**：DRAFT

---

## 一、交付目标（What Done Looks Like）

本 sprint 交付"员工上传 zip → 无头评估 → 公网报告"最小闭环。完成后，ZenithJoy 内部员工可通过 Basic Auth 保护的上传页，将在 Codex/ChatGPT/Claude 上做的 skill 打成 zip 提交，Brain 单 slot 串行执行评估容器，评估完成后报告发布至 HK 公网可访问，员工持 Basic Auth 可打开报告。

---

## 二、核心交付件（Deliverables）

| 编号 | 交付件 | 路径 / 位置 |
|------|--------|-------------|
| D1 | Brain eval 端点 | `packages/brain/src/routes/eval.js` |
| D2 | Brain tick 单 slot 调度 | `packages/brain/src/tick.js`（skill_eval 分支） |
| D3 | docker-executor skill_eval 分支 | `packages/brain/src/docker-executor.js` |
| D4 | 飞书告警（失败聚合） | `packages/brain/src/feishu-alert.js` |
| D5 | 单元测试（硬校验+去重+槽位+额度预检） | `packages/brain/src/__tests__/eval.test.js` |
| D6 | 报告 SSH 发布脚本 | `scripts/publish-skill-eval-report.sh` |
| D7 | HK 反代配置（Caddy/nginx） | HK `/etc/caddy/Caddyfile` 或 nginx conf |
| D8 | 最小上传页 | `apps/eval-upload/index.html`（或独立 HTML） |

---

## 三、功能范围

### 3.1 在范围内

1. **上传端点 `POST /api/eval/upload`**
   - Basic Auth + X-Eval-Proxy-Token 双重验证
   - 硬校验：zip 魔数 / 解压 ≤50MB / 压缩比 ≤100:1 / 必含唯一 SKILL.md / 路径穿越拦截
   - hash 去重：命中 completed → 返回历史 report_url；命中 in_progress → 合流返回既有 task_id
   - pending ≥20 → 拒新（HTTP 429）
   - zip 落 staging → 建 task_type=skill_eval

2. **状态查询端点 `GET /api/eval/status/:task_id`**
   - 返回 `{ status, queue_position, report_url }`
   - 未完成时 report_url=null，completed 时返回公网链接

3. **Brain tick 单 slot 串行调度**
   - MAX_CONCURRENT_SKILL_EVAL=1（环境变量，禁止写死）
   - 额度预检：account2 5h 池 ≥85% + 7d 池 ≥90% 才派发；不足 → 飞书告警 + task pending 保留
   - 超时 SKILL_EVAL_TIMEOUT=30min → failed(timeout) + 释放 slot

4. **docker-executor skill_eval 分支**
   - CECELIA_CREDENTIALS=account2
   - 容器内调 skill-evaluator quick 模式（`claude -p --model sonnet`）
   - 任何失败路径释放 slot + 飞书告警（10min 同类聚合）

5. **报告 SSH 发布**
   - 目标：HK `/data/docs/skill-evals/<task短码>-<名slug>/`
   - 评估索引页追加本次条目
   - 回写 report_url → task completed

6. **HK 反代**
   - `/eval-api/` location → 注入 X-Eval-Proxy-Token → 转发 Brain `/api/eval/`
   - docs 域 Basic Auth 覆盖 `/eval` 路径与 `/data/docs/skill-evals/` 路径

7. **最小上传页**
   - Basic Auth 保护，zip 拖拽 + skill 名称 + 来源平台 + 归属线 + 选填提交人
   - 前端预校验：.zip 扩展 + ≤10MB + 必填齐
   - 提交后显示 task_id + 队列位置，5s 起 ×1.5 指数退避封顶 30s 轮询

8. **staging 清理**：成功 3 天 / 失败 14 天

### 3.2 不在范围内

- FR38-FR53 强化项（slug 净化细节/GBK 容忍/多 skill 判非法/索引分页/发布前扫密/slot 租约 TTL 等）
- full 模式评估、失败自动重试、个人账号体系

---

## 四、铁律约束（Invariants）

所有实现必须严格遵守：

1. **单 slot 串行**：MAX_CONCURRENT_SKILL_EVAL=1 通过环境变量注入，不得写死数值
2. **禁写死环境假设**：HK IP / Tailscale 地址 / 端口 / 账号路径 / token 禁止写死，必须从环境变量或运行时推导
3. **真环境验证才算 done**：E2E 必须真实上传 zip 走公网端点，容器真实执行 skill-evaluator，报告真实可访问
4. **凭据安全**：X-Eval-Proxy-Token / Basic Auth / account2 凭据不硬编码、不进 git、不进日志
5. **日志脱敏**：zip 内容 / skill 源码 / 评估中间输出不得明文进日志
6. **端点鉴权**：Brain `/api/eval/upload` 必须校验 X-Eval-Proxy-Token（403 拒非法）；docs 域 Basic Auth 必须覆盖评估报告路径（401 拒非法）
7. **去重幂等**：同一 zip hash 命中 completed 直接返回历史 report_url，不重复跑
8. **失败释放 slot**：任何失败路径（dispatch/crash/timeout/publish）必须无条件释放 slot

---

## 五、NFR 约束汇总

| 指标 | 约束值 | 环境变量 |
|------|--------|----------|
| 上传大小（前端） | ≤10MB | MAX_ZIP_MB |
| 解压大小 | ≤50MB | — |
| 压缩比 | ≤100:1（文件数≤2000） | — |
| 评估超时 | 30min | SKILL_EVAL_TIMEOUT |
| 背压阈值 | pending ≥20 → 429 | — |
| 并发槽位 | 1 | MAX_CONCURRENT_SKILL_EVAL |
| 轮询策略 | 5s×1.5 指数退避，上限 30s | — |
| staging 清理 | 成功 3d / 失败 14d | — |
| 额度预检（5h） | ≥85% 才派发；告警线 70% | — |
| 额度预检（7d） | ≥90% 才派发；告警线 80% | — |
| 飞书聚合 | 10min 同类聚合；连败≥3 升级 | — |

---

## 六、失败四态处理

| 失败态 | 标记 | 动作 |
|--------|------|------|
| 容器起不来 | `failed(dispatch)` | 释放 slot + 飞书告警 |
| 会话崩溃 | `failed(crash)` | 释放 slot + 飞书告警 |
| 超时 30min | `failed(timeout)` | 释放 slot + 飞书告警 |
| SSH 发布失败 | `failed(publish)` | 释放 slot + 飞书告警 + 进重试队列 |

员工侧统一显示："评估失败：`<阶段>`，可重新提交"

---

## 七、E2E 验收

> **目标环境**：windows_cloud（GitHub Actions windows-latest runner）
> **E2E Fixture**：`~/incoming/日报skill-v1.2-7.7.zip`

```bash
#!/usr/bin/env bash
# E2E 验收脚本 — Skill Evaluator thin 贯穿
# 目标环境: windows_cloud / GitHub Actions windows-latest
# 运行前提: EVAL_BASIC_AUTH / EVAL_HOST / BRAIN_HOST 环境变量已设置

set -euo pipefail

FIXTURE_ZIP="${HOME}/incoming/日报skill-v1.2-7.7.zip"
EVAL_HOST="${EVAL_HOST:-docs.zenjoymedia.media}"
BRAIN_HOST="${BRAIN_HOST:-localhost:5221}"  # 实际为 US Brain 地址
BASIC_AUTH="${EVAL_BASIC_AUTH}"  # user:pass from ~/.credentials/

echo "=== Step 1: 真实上传 zip → 取得 task_id ==="
UPLOAD_RESP=$(curl -sf \
  -u "${BASIC_AUTH}" \
  -F "file=@${FIXTURE_ZIP}" \
  -F "skill_name=日报skill" \
  -F "platform=Claude" \
  -F "journey_id=line00" \
  "https://${EVAL_HOST}/eval-api/upload")
echo "Upload response: ${UPLOAD_RESP}"
TASK_ID=$(echo "${UPLOAD_RESP}" | jq -r '.task_id')
[[ "${TASK_ID}" != "null" && -n "${TASK_ID}" ]] || { echo "FAIL: 未返回 task_id"; exit 1; }
echo "task_id=${TASK_ID}"

echo "=== Step 2: 轮询至 completed（≤30min）==="
DEADLINE=$((SECONDS + 1800))
REPORT_URL=""
INTERVAL=5
while [[ $SECONDS -lt $DEADLINE ]]; do
  STATUS_RESP=$(curl -sf \
    -u "${BASIC_AUTH}" \
    "https://${EVAL_HOST}/eval-api/status/${TASK_ID}" || true)
  STATUS=$(echo "${STATUS_RESP}" | jq -r '.status // "unknown"')
  echo "  [$(date +%H:%M:%S)] status=${STATUS}"
  if [[ "${STATUS}" == "completed" ]]; then
    REPORT_URL=$(echo "${STATUS_RESP}" | jq -r '.report_url')
    break
  fi
  if [[ "${STATUS}" == failed* ]]; then
    echo "FAIL: 任务失败 status=${STATUS}"; exit 1
  fi
  sleep "${INTERVAL}"
  INTERVAL=$(echo "${INTERVAL} * 1.5" | bc | awk '{if($1>30)print 30; else printf "%.0f\n",$1}')
done
[[ -n "${REPORT_URL}" ]] || { echo "FAIL: 30min 内未 completed"; exit 1; }
echo "report_url=${REPORT_URL}"

echo "=== Step 3: 带 Basic Auth 访问 report_url → HTTP 200 且含"功能地图"与"裁决" ==="
REPORT_BODY=$(curl -sf -u "${BASIC_AUTH}" "${REPORT_URL}")
echo "${REPORT_BODY}" | grep -q "功能地图" || { echo "FAIL: 报告不含'功能地图'"; exit 1; }
echo "${REPORT_BODY}" | grep -q "裁决" || { echo "FAIL: 报告不含'裁决'"; exit 1; }
echo "  PASS: 报告内容验证通过"

echo "=== Step 4: 同一 report_url 不带 Basic Auth → 401 ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${REPORT_URL}")
[[ "${HTTP_CODE}" == "401" ]] || { echo "FAIL: 期望 401 但得到 ${HTTP_CODE}"; exit 1; }
echo "  PASS: 不带 Basic Auth → 401"

echo "=== Step 5: 不带 X-Eval-Proxy-Token 直打 Brain /api/eval/upload → 403 ==="
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -F "file=@${FIXTURE_ZIP}" \
  "http://${BRAIN_HOST}/api/eval/upload")
[[ "${HTTP_CODE}" == "403" ]] || { echo "FAIL: 期望 403 但得到 ${HTTP_CODE}"; exit 1; }
echo "  PASS: 无 token 直打 Brain → 403"

echo "=== Step 6: 评估索引页含本次条目 ==="
INDEX_BODY=$(curl -sf -u "${BASIC_AUTH}" "https://${EVAL_HOST}/eval-api/index" || \
             curl -sf -u "${BASIC_AUTH}" "https://${EVAL_HOST}/data/docs/skill-evals/index.html")
echo "${INDEX_BODY}" | grep -q "${TASK_ID}" || \
  echo "${INDEX_BODY}" | grep -q "日报skill" || \
  { echo "FAIL: 索引页不含本次评估条目"; exit 1; }
echo "  PASS: 索引页含本次评估条目"

echo ""
echo "=== 全部验收通过 ==="
```

### E2E 验收点总结

| # | 验收点 | 期望结果 |
|---|--------|----------|
| E1 | 上传 `~/incoming/日报skill-v1.2-7.7.zip` 带 Basic Auth | HTTP 200 + 返回 `task_id` |
| E2 | 轮询 `/eval-api/status/:task_id` | ≤30min 变 `completed`，返回 `report_url` |
| E3 | `curl -u basic_auth report_url` | HTTP 200 + 正文含"功能地图"与"裁决" |
| E4 | `curl report_url`（不带 Basic Auth） | HTTP 401 |
| E5 | 直打 Brain `/api/eval/upload` 不带 token | HTTP 403 |
| E6 | 评估索引页 | 含本次 task_id 或 skill 名称条目 |

---

## 八、假设与前提

- skill-evaluator quick 模式调用接口与 zenithjoy-skills #103 的 eval 方式一致，Generator 需先确认容器内调用方式
- HK docs.zenjoymedia.media 的 Basic Auth 凭据已存 1Password CS "ZenithJoy 文档中心 (HK docs)"
- X-Eval-Proxy-Token 由 Generator 生成并写入 1Password CS + ~/.credentials/，不硬编码
- HK→US Tailscale IP 以实施时 `tailscale status` 为准，禁止写死
- `~/incoming/日报skill-v1.2-7.7.zip` 为 E2E fixture，已知评估结果可比对
- mmv 为生产派发宿主，docker 可用

---

## 九、报告格式

评估报告必须包含以下四态状态字段：

```
status: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
```

报告页面必须包含：
- 功能地图（第一屏）
- 裁决（DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED + 说明）
- 缺陷清单（如有）

---

*合同草案生成于 2026-07-07，由 harness-contract-proposer 产出。*
