# Contract DoD — Skill Evaluator 内部验收台（thin 贯穿首 Run）

**Sprint**：07072314-skill-eval-service
**Journey**：Line 00（ZenithJoy 运营中枢）
**合同版本**：v1.0（首轮，无前置 reviewer feedback）
**生成日期**：2026-07-07

---

## DoD 总览

| 分类 | 条目数 | 全部通过才算 Done |
|------|--------|------------------|
| 铁律覆盖 [INVARIANT] | 8 | ✓ |
| 行为断言 [BEHAVIOR] | 10 | ✓ |
| 单元测试 [UNIT] | 5 | ✓ |
| 可观测性 [OBSERVABILITY] | 1 | ✓ |
| 安全合规 [SECURITY] | 2 | ✓ |

---

## 一、铁律覆盖 [INVARIANT]

> 来源：PrepPRD Invariant 约束，全部为 blocking 条目

- [ ] **[INVARIANT-1] zip 上传硬校验**
  - zip 魔数校验（首2字节 `PK`）
  - 解压后总大小 ≤50MB
  - 压缩比 ≤100:1（文件数 ≤2000）
  - 必须含且仅含一个 SKILL.md（多个 → 422）
  - 路径穿越拦截（含 `../` 的条目 → 422）
  - 违反任一 → HTTP 422 + 具体错误描述

- [ ] **[INVARIANT-2] hash 去重幂等**
  - 同一 zip sha256 hash 命中 completed → 直接返回历史 report_url，不重跑
  - 命中 in_progress → 合流返回既有 task_id，不新建 task

- [ ] **[INVARIANT-3] 单 slot 串行**
  - MAX_CONCURRENT_SKILL_EVAL=1 通过环境变量注入
  - 任意时刻同时运行的 skill_eval task ≤1
  - pending ≥20 → 拒新（HTTP 429）

- [ ] **[INVARIANT-4] 额度预检**
  - account2 5h 池剩余 ≥85% 才派发
  - account2 7d 池剩余 ≥90% 才派发
  - 不满足 → 飞书告警 + task 保留 pending（不丢弃）

- [ ] **[INVARIANT-5] 报告 SSH 发布**
  - 评估完成后 SSH 到 HK `/data/docs/skill-evals/<task短码>-<名slug>/`
  - 追加评估索引页条目
  - 回写 report_url → task 状态置 completed

- [ ] **[INVARIANT-6] 状态查询端点**
  - `GET /api/eval/status/:task_id` 返回 `{ status, queue_position, report_url }`
  - completed 时 report_url 非空，其余时为 null

- [ ] **[INVARIANT-7] Basic Auth + X-Eval-Proxy-Token 双重验证**
  - docs 域所有 `/eval` 路径受 Basic Auth 保护（无 auth → 401）
  - Brain `/api/eval/upload` 校验 X-Eval-Proxy-Token（无 token 或 token 错 → 403）

- [ ] **[INVARIANT-8] 失败四态 slot 释放**
  - `failed(dispatch)` / `failed(crash)` / `failed(timeout)` / `failed(publish)` 任意一态
  - 必须无条件释放 slot（in_progress_count 归零）
  - 触发飞书告警（10min 同类聚合）

---

## 二、行为断言 [BEHAVIOR]

> 所有 [BEHAVIOR] 条目均为可自动化验证的技术断言，对应 contract-draft.md 的 E2E 验收点

- [ ] **[BEHAVIOR-1] 上传合法 zip → 建 task 返回 task_id**
  ```
  断言：POST /api/eval/upload（带合法 X-Eval-Proxy-Token + 合法 zip）
        → HTTP 200 + body.task_id 非空 + body.queue_position ≥ 0
  ```

- [ ] **[BEHAVIOR-2] 非法 zip 上传 → 422 + 具体原因**
  ```
  断言（逐一验证）：
  · 非 zip 魔数文件 → HTTP 422 + error 含 "magic"
  · 解压超 50MB zip → HTTP 422 + error 含 "解压" 或 "size"
  · 缺 SKILL.md → HTTP 422 + error 含 "SKILL.md"
  · 含路径穿越（../) → HTTP 422 + error 含 "traversal" 或 "路径"
  ```

- [ ] **[BEHAVIOR-3] hash 去重 completed → 返回历史 report_url**
  ```
  断言：相同 zip 二次上传（首次已 completed）
        → HTTP 200 + body.report_url == 首次 report_url
        + body.deduped == true（或等效字段）
  ```

- [ ] **[BEHAVIOR-4] 不带 X-Eval-Proxy-Token 直打 Brain → 403**
  ```
  断言：POST http://<BRAIN_HOST>/api/eval/upload（无 X-Eval-Proxy-Token header）
        → HTTP 403
  ```

- [ ] **[BEHAVIOR-5] report_url 不带 Basic Auth → 401**
  ```
  断言：curl <report_url>（无 Authorization header）
        → HTTP 401
  ```

- [ ] **[BEHAVIOR-6] 评估完成后 report_url 内容完整**
  ```
  断言：curl -u <basic_auth> <report_url>
        → HTTP 200
        + 正文含"功能地图"
        + 正文含"裁决"
        + status 字段 ∈ {DONE, DONE_WITH_CONCERNS, NEEDS_CONTEXT, BLOCKED}
  ```

- [ ] **[BEHAVIOR-7] pending ≥20 → 新上传 429**
  ```
  断言（可 mock pending count = 20 或实测）：
        POST /api/eval/upload（合法 zip，pending 队列已满）
        → HTTP 429 + error 含 "排队已满" 或 "queue full"
  ```

- [ ] **[BEHAVIOR-8] 失败后 slot 释放（可单元级验证）**
  ```
  断言：模拟 failed(timeout) 路径后
        → in_progress_count == 0
        → 下一个 pending task 可被 tick 拾起
  ```

- [ ] **[BEHAVIOR-9] 状态查询返回 queue_position**
  ```
  断言：GET /api/eval/status/<task_id>（task 处于 pending 中）
        → HTTP 200 + body.queue_position ≥ 1
        → body.status ∈ {pending, in_progress, completed, failed}
  ```

- [ ] **[BEHAVIOR-10] 评估索引页含本次条目**
  ```
  断言：评估完成后访问索引页（带 Basic Auth）
        → HTTP 200 + 正文含 task_id 或 skill 名称
  ```

---

## 三、单元测试 [UNIT]

> 对应 `packages/brain/src/__tests__/eval.test.js`

- [ ] **[UNIT-1] 硬校验覆盖（5 种非法输入各有独立 test case）**
  - 非 zip 魔数、解压超 50MB、压缩比超 100:1、缺 SKILL.md、路径穿越

- [ ] **[UNIT-2] hash 去重逻辑（2 种路径）**
  - 命中 completed → 返回历史 report_url
  - 命中 in_progress → 返回既有 task_id

- [ ] **[UNIT-3] 单 slot 并发控制**
  - MAX_CONCURRENT_SKILL_EVAL 从环境变量读取
  - 同时只允许 1 个 in_progress skill_eval

- [ ] **[UNIT-4] 额度预检（2 种失败场景）**
  - 5h 池 <85% → 不派发 + 返回 pending
  - 7d 池 <90% → 不派发 + 返回 pending

- [ ] **[UNIT-5] 失败路径 slot 释放**
  - dispatch/crash/timeout/publish 各路径后 slot 归零

---

## 四、可观测性 [OBSERVABILITY]

- [ ] **[OBS-1] evals 表字段完整**
  ```
  evals 表至少含：task_id / zip_hash / status / queue_position /
  report_url / created_at / completed_at / failure_reason
  ```

---

## 五、安全合规 [SECURITY]

- [ ] **[SEC-1] 凭据不入 git / 日志**
  - X-Eval-Proxy-Token / Basic Auth / account2 凭据不在任何 git 追踪文件中
  - 日志不含 zip 内容、skill 源码、评估中间输出明文

- [ ] **[SEC-2] 路径穿越拦截**
  - 含 `../` 或绝对路径的 zip 条目 → 422 + 拦截日志（脱敏）

---

## 六、manual:bash 可执行验收命令

> 以下命令可在有网络权限的机器上直接执行，对应 E2E 验收的 6 个核心点

```bash
#!/usr/bin/env bash
# =============================================================
# manual:bash 验收命令集
# 前提：EVAL_HOST / EVAL_BASIC_AUTH / BRAIN_HOST 环境变量已 source
# source ~/.credentials/skill-eval.env  （Generator 创建）
# =============================================================

# ---- 1. 上传 fixture zip → 取 task_id ----
echo "--- 验收点1: 上传 zip ---"
UPLOAD_RESP=$(curl -sf \
  -u "${EVAL_BASIC_AUTH}" \
  -F "file=@${HOME}/incoming/日报skill-v1.2-7.7.zip" \
  -F "skill_name=日报skill" \
  -F "platform=Claude" \
  -F "journey_id=line00" \
  "https://${EVAL_HOST}/eval-api/upload")
TASK_ID=$(echo "${UPLOAD_RESP}" | jq -r '.task_id')
echo "task_id=${TASK_ID}"

# ---- 2. 轮询状态（快速验证，不等 30min，验证接口可用即可）----
echo "--- 验收点2: 状态查询接口 ---"
curl -sf -u "${EVAL_BASIC_AUTH}" \
  "https://${EVAL_HOST}/eval-api/status/${TASK_ID}" | jq .

# ---- 3. 验证 403（不带 token 直打 Brain）----
echo "--- 验收点5: 无 token 直打 Brain → 403 ---"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -F "file=@${HOME}/incoming/日报skill-v1.2-7.7.zip" \
  "http://${BRAIN_HOST}/api/eval/upload")
echo "期望 403，实际: ${HTTP_CODE}"

# ---- 4. 完整 E2E（需 ≤30min，等 completed 后执行）----
# 等 completed 后执行以下命令验证报告内容和 401
# REPORT_URL="从 status 接口取到的 report_url"
# curl -sf -u "${EVAL_BASIC_AUTH}" "${REPORT_URL}" | grep -E "功能地图|裁决"
# HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "${REPORT_URL}")
# echo "不带 auth 期望 401，实际: ${HTTP_CODE}"

# ---- 5. 硬校验 422 验证 ----
echo "--- 验收点: 非法文件 → 422 ---"
echo "not a zip" > /tmp/fake.zip
HTTP_CODE=$(curl -s -o /tmp/422resp.txt -w "%{http_code}" \
  -u "${EVAL_BASIC_AUTH}" \
  -H "X-Eval-Proxy-Token: ${EVAL_PROXY_TOKEN}" \
  -F "file=@/tmp/fake.zip" \
  -F "skill_name=test" \
  "http://${BRAIN_HOST}/api/eval/upload")
echo "期望 422，实际: ${HTTP_CODE}"
cat /tmp/422resp.txt

echo "--- manual:bash 验收命令执行完毕 ---"
```

---

## 七、铁律覆盖矩阵

| 铁律 | PrepPRD 原文 | DoD 对应条目 | 覆盖 |
|------|-------------|-------------|------|
| zip 上传硬校验 | 魔数/解压≤50MB/压缩比≤100:1/必含唯一SKILL.md/路径穿越拦截 | INVARIANT-1, BEHAVIOR-2, UNIT-1, SEC-2 | ✓ |
| hash 去重 | 命中completed→历史url；命中in_progress→合流 | INVARIANT-2, BEHAVIOR-3, UNIT-2 | ✓ |
| 单slot串行 | MAX_CONCURRENT_SKILL_EVAL=1；pending≥20拒新 | INVARIANT-3, BEHAVIOR-7, UNIT-3 | ✓ |
| 额度预检 | 5h≥85% + 7d≥90% 才派发 | INVARIANT-4, UNIT-4 | ✓ |
| 报告发布 | SSH到HK /data/docs/skill-evals/<短码>-<slug>/ | INVARIANT-5, BEHAVIOR-6, BEHAVIOR-10 | ✓ |
| 状态查询端点 | 返回queue_position + report_url | INVARIANT-6, BEHAVIOR-9 | ✓ |
| Basic Auth + X-Eval-Proxy-Token | 双重验证 | INVARIANT-7, BEHAVIOR-4, BEHAVIOR-5 | ✓ |
| 失败四态释放slot | dispatch/crash/timeout/publish→释放+告警 | INVARIANT-8, BEHAVIOR-8, UNIT-5 | ✓ |

**铁律覆盖：8/8 条**

---

## 八、[BEHAVIOR] 条目汇总

| 编号 | 简述 | 自动化可行 |
|------|------|-----------|
| BEHAVIOR-1 | 合法上传→task_id | ✓ |
| BEHAVIOR-2 | 非法zip→422+原因 | ✓ |
| BEHAVIOR-3 | hash去重completed→历史url | ✓ |
| BEHAVIOR-4 | 无token直打Brain→403 | ✓ |
| BEHAVIOR-5 | report_url无auth→401 | ✓ |
| BEHAVIOR-6 | 报告含功能地图+裁决+四态status | ✓ |
| BEHAVIOR-7 | pending≥20→429 | ✓（可mock） |
| BEHAVIOR-8 | 失败后slot释放 | ✓（单元级） |
| BEHAVIOR-9 | 状态查询返回queue_position | ✓ |
| BEHAVIOR-10 | 索引页含本次条目 | ✓ |

**[BEHAVIOR] 条目总数：10 条（≥4 条要求已满足）**

---

*DoD 由 harness-contract-proposer 产出，2026-07-07。Generator 实施前须逐条确认 [ ] 状态，评估前须全部变为 [x]。*
