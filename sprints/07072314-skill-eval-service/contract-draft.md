# Contract Draft — Skill Evaluator 内部验收台（thin 贯穿）

Sprint: 07072314-skill-eval-service
Task: 52145edd-e409-4459-9490-7a02bf8e87de
Journey: Line 00 — ZenithJoy 运营中枢
Feature: Skill Evaluator 内部验收台（907eb57f-33c1-46f5-bf0b-7cfb81540063）
日期: 2026-07-07
版本: v1（初稿，无上轮 reviewer feedback）

---

## 目标陈述

本次 Sprint 交付"员工上传 skill zip → 无头评估 → 公网报告"的 thin 最小闭环。员工通过 HK 域上传页提交 zip，Brain 排队串行调 skill-evaluator quick 模式评估，报告发布到 HK 文档中心，员工通过链接（Basic Auth 保护）查看报告。

---

## 技术断言

### 上传与接收层

| 断言 | 可验证形式 |
|------|-----------|
| Brain `POST /api/brain/skill-eval/upload` 端点存在 | curl 打端点返回非 404 |
| 不带 X-Eval-Proxy-Token → 403 | `curl -s -o /dev/null -w "%{http_code}" -F file=@... http://localhost:5221/api/brain/skill-eval/upload` 返回 403 |
| 带有效 token → 进入校验流程 | 返回 201（成功入队）或 400（校验失败），不返回 403 |
| multer 接收上传文件，写入 staging 目录 | staging 目录下出现文件 |

### zip 硬校验层

| 断言 | 触发条件 | 期望响应 |
|------|---------|---------|
| zip 魔数校验 | 上传非 zip 文件或头部损坏 | HTTP 400，body 含 `invalid_zip` |
| 解压大小限制 | 解压后 > 50MB | HTTP 400，body 含 `unzip_too_large` |
| 压缩比限制 | 压缩比 > 100:1 | HTTP 400，body 含 `compression_ratio_exceeded` |
| 文件数限制 | zip 内 > 2000 文件 | HTTP 400，body 含 `file_count_exceeded` |
| SKILL.md 必须存在且唯一 | 0 个或 >1 个 SKILL.md | HTTP 400，body 含 `skill_md_missing` 或 `skill_md_multiple` |
| 路径穿越拦截 | 含 `../` 或绝对路径条目 | HTTP 400，body 含 `path_traversal`，整包拒绝 |

### SHA-256 去重层

| 场景 | 期望行为 |
|------|---------|
| 首次上传（DB 无记录） | 建 task，HTTP 201，返回 `{task_id, status: "pending"}` |
| 同 hash，task status = pending/running | 不建新 task，HTTP 200，返回已有 `{task_id, status}` |
| 同 hash，task status = completed | 不建新 task，HTTP 200，返回 `{task_id, report_url, deduplicated: true}` |

### 调度与执行层

| 断言 | 可验证形式 |
|------|-----------|
| 单 slot 串行：DB 中 running 的 skill_eval task 同时 ≤ 1 | `SELECT COUNT(*) FROM tasks WHERE task_type='skill_eval' AND status='running'` ≤ 1 |
| pending ≥ 20 → 拒绝新提交 | HTTP 429，body 含 `queue_full` |
| 额度预检：5h 池 < 85% 时不派发 | task 保持 pending；飞书告警触发（log 可见） |
| 额度预检：7d 池 < 90% 时不派发 | task 保持 pending；飞书告警触发（log 可见） |
| docker-executor 以 account2 / sonnet / quick 模式启动容器 | 容器启动命令含 `--model sonnet` + account2 凭据 |

### 发布链路

| 断言 | 可验证形式 |
|------|-----------|
| 报告发布到 HK `/data/docs/skill-evals/<短码>-<slug>/` | ssh hk-vps `ls /data/docs/skill-evals/` 含对应目录 |
| 报告 index.html 含"功能地图"关键词 | `grep "功能地图" /data/docs/skill-evals/<task>/index.html` |
| 报告 index.html 含"裁决"关键词 | `grep "裁决" /data/docs/skill-evals/<task>/index.html` |
| 索引页追加条目（最新 50 条） | `/data/docs/skill-evals/index.html` 含 task_id |
| task 完成后 report_url 回写到 DB | `SELECT report_url FROM tasks WHERE id=<task_id>` 非空 |
| evals 表写入一行（含 duration_ms） | `SELECT * FROM evals WHERE task_id=<task_id>` 返回 1 行 |

### 保护与访问控制

| 断言 | 可验证形式 |
|------|-----------|
| report_url 不带 Basic Auth → 401 | `curl -s -o /dev/null -w "%{http_code}" $REPORT_URL` = 401 |
| report_url 带 Basic Auth → 200 | `curl -s -o /dev/null -w "%{http_code}" -u "$BASIC_AUTH" $REPORT_URL` = 200 |
| nginx `/eval-api/` location 注入 X-Eval-Proxy-Token | nginx conf 含 `proxy_set_header X-Eval-Proxy-Token` |

### 状态查询端点

| 断言 | 可验证形式 |
|------|-----------|
| `GET /api/brain/skill-eval/status/:task_id` 返回 `{status, queue_position, report_url}` | curl 打端点，jq 验证字段存在 |
| 不存在 task_id → 404 | `curl -s -o /dev/null -w "%{http_code}" .../status/00000000-0000-0000-0000-000000000000` = 404 |

### 可观测性

| 断言 | 可验证形式 |
|------|-----------|
| evals 表存在且含必要列 | `\d evals` 返回 task_id / skill_name / status / report_url / duration_ms / created_at |
| 环境变量驱动所有 NFR 数值（无 hardcode） | grep 搜索关键 NFR 数值（50、100、2000、20、30、85、90）不直接出现在业务逻辑中 |

---

## 受影响文件列表

### packages/brain/

| 文件 | 变更类型 | 说明 |
|------|---------|------|
| `src/server.js` | 修改 | 注册 `/api/brain/skill-eval/upload` 和 `/api/brain/skill-eval/status/:task_id` |
| `src/tick.js` | 修改 | skill_eval task_type 派发逻辑 + 单 slot 调度检查 |
| `src/skill-eval/upload-handler.js` | 新增 | multer 接收 / 令牌验证 / 硬校验 / hash 去重 / staging 落盘 / task 建立 |
| `src/skill-eval/dispatcher.js` | 新增 | 额度预检 / docker-executor 调用 / slot 管理 / 失败四态处理 |
| `src/skill-eval/publisher.js` | 新增 | SSH 发布报告 / 索引页追加 / report_url 回写 |
| `src/skill-eval/alerts.js` | 新增 | 飞书告警聚合（10min 同类 / 连败 ≥3 升级）|
| `migrations/<timestamp>_create_evals.sql` | 新增 | evals 表 DDL |
| `static/skill-eval/index.html` | 新增 | 最小上传页（拖拽 / 必填 / 轮询 / 查看报告）|
| `package.json` | 修改 | multer / node-ssh 等依赖 |

### HK 服务器（SSH 操作，不在 repo 内）

| 位置 | 变更 |
|------|------|
| `/etc/nginx/conf.d/zj-docs.conf` | 新增 `location /eval-api/` 反代块（继承 Basic Auth + 注入 token）|
| `/data/docs/skill-evals/` | 新建目录 + index.html 骨架 |

---

## 里程碑对应

| 里程碑 | 关键产出 | DoD 条目 |
|--------|---------|---------|
| M1 — Brain 数据层 | evals 表 migration + upload 端点骨架（令牌验证）| B01, B07 |
| M2 — 校验与去重 | 硬校验五项 + 路径穿越 + SHA-256 去重 | B02, B03 |
| M3 — 调度与执行 | tick 单 slot + 额度预检 + docker-executor 扩展 | B04, B05, B06 |
| M4 — 发布链路 | SSH 发布 + 索引页 + report_url 回写 + 失败四态告警 | B07, B08, B10 |
| M5 — 前端与反代 | HK nginx location + 上传页 + 状态查询端点 | B08, B09 |
| M6 — E2E 验收 | Final E2E 全链路通过 + CI 全绿 | 全部 |

---

## Invariant 覆盖确认

| Invariant | 合同覆盖 |
|-----------|---------|
| 零 hardcode（所有 NFR 来自 env） | 断言中含 env-var grep 验证 |
| 令牌验证不可绕过 | B01 + Final E2E Step 5 |
| Basic Auth 不可绕过（报告 401）| B08 + Final E2E Step 4 |
| 路径穿越拦截 | B02（路径穿越子项）|
| 单 slot 强保证 | B04 |
| staging TTL 生命周期 | B05 说明（3天/14天），由 publisher.js + cron 实现 |
| 报告永久留存 | B08（独立于 staging，ssh 存放 HK）|
| 生产派发宿主 = mmv | dispatcher.js SSH 目标为 mmv，env-var 配置，禁写死 IP |
| hash 去重幂等 | B03 |
| evals 表必须落库 | B07 |

---

## E2E 验收

### 单元测试（CI 门禁）

```bash
# 运行 skill-eval 相关单元测试
cd /workspace
npm test --workspace=packages/brain -- --testPathPattern="skill-eval"
```

覆盖范围：
- `upload-handler.test.js` — 令牌验证、硬校验六项、hash 去重三态、背压
- `dispatcher.test.js` — 单 slot 逻辑、额度预检、docker-executor mock 调用
- `publisher.test.js` — 索引页追加、report_url 回写、evals 表写入

### Final E2E（真环境，全链路）

前置条件：
1. `~/incoming/日报skill-v1.2-7.7.zip` 文件存在
2. Brain 在 mmv 运行，HK nginx 已配置 `/eval-api/` 反代
3. 1Password CS Vault 含 `ZenithJoy Docs Basic Auth` 凭据
4. HK `/data/docs/skill-evals/` 目录已创建

```bash
bash /workspace/sprints/07072314-skill-eval-service/tests/final-e2e.sh
```

验收步骤：
1. 通过公网 Basic Auth 上传 `日报skill-v1.2-7.7.zip`，获取 task_id
2. 5s → ×1.5 退避轮询状态，≤30min 内达到 completed
3. 断言报告内容含"功能地图"和"裁决"关键词
4. 断言不带 Basic Auth 访问 report_url 返回 401
5. 断言不带 X-Eval-Proxy-Token 直打 Brain 上传端点返回 403
6. 断言评估索引页含本次 task_id 条目

所有步骤通过后输出：`=== ALL ASSERTIONS PASSED ===`

---

## 风险与注意事项

| 风险 | 缓解措施 |
|------|---------|
| mmv → HK SSH 发布链路中断 | publisher.js 捕获 SSH 异常 → failed(publish) 四态处理 + 飞书告警 |
| docker-executor 容器超时 | SKILL_EVAL_TIMEOUT=30min 环境变量控制；超时 → slot 释放 + 飞书告警 |
| account2 额度耗尽 | 额度预检（B05）+ 额度告警（5h < 70% / 7d < 80%）|
| 大量 pending 导致内存/磁盘压力 | 背压阈值 20（B06）+ staging TTL 清理 |
| skill-evaluator quick 模式产出缺少必要章节 | publisher.js 验证 report 含"功能地图"和"裁决"，否则标记 failed(publish) |
