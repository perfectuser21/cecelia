# Sprint PRD — Skill Evaluator 内部验收台（形态 B）thin 贯穿

## OKR 对齐

- **Journey**：Line 00 — ZenithJoy 运营中枢（journey_id: 36cc40c2-ba63-814c-96f3-fd3fc92cac96）
- **Feature**：Skill Evaluator 内部验收台（feature_id: 907eb57f-33c1-46f5-bf0b-7cfb81540063，kind=ability）
- **Task**：52145edd-e409-4459-9490-7a02bf8e87de
- **本次推进预期**：thin 走通"员工上传 skill zip → 无头评估 → 公网报告"最小闭环

## 背景

ZenithJoy 员工在 Codex / ChatGPT / Claude 等平台产出 skill 包后，目前需要手动触发 Claude Code 跑 skill-evaluator 出评估报告，流程重、无法规模化。本次 Sprint 搭建内部验收台薄切（thin）版：员工访问 docs 域上传页 → 上传 zip → 系统排队串行调 skill-evaluator quick 模式 → 报告发布到文档中心 → 员工凭链接查看。全程零现金成本（消耗 account2 包月 Sonnet 额度）。

## Golden Path（核心场景，单线性）

1. 员工访问 `https://docs.zenjoymedia.media/skill-eval`（Basic Auth 验证通过）→ 看到上传表单（zip 拖拽区 + skill 名称 + 来源平台 + 归属链 + 选填提交人）
2. 员工上传 zip → 前端预校验（.zip 扩展名 / 大小 ≤10MB / 必填齐）→ POST `/eval-api/upload`（同源）→ 页面显示"已进队列，前面还有 N 个" + task_id
3. **反代层**：HK Caddy/nginx 验 Basic Auth + 注入 `X-Eval-Proxy-Token` → 转发 Brain `/api/brain/skill-eval/upload`
4. **Brain 接收层**：验令牌（403 if absent）→ 硬校验（zip 魔数 / 解压 ≤50MB / 压缩比 ≤100:1 文件数 ≤2000 / 必含唯一 SKILL.md / 路径穿越拦截）→ SHA-256 hash 去重（completed 同包返历史 report_url；进行中合流返既有 task_id）→ zip 落 staging → 建 task（task_type=skill_eval，status=pending）
5. **Brain tick 派发**：单 slot 串行（MAX_CONCURRENT_SKILL_EVAL=1 / pending ≥20 拒新并返"排队已满"）→ 额度预检（account2 5h 池 ≥85% / 7d 池 ≥90%，不足则 pending 保留 + 飞书告警）→ docker-executor 启容器（claude -p --model sonnet / CECELIA_CREDENTIALS=account2）→ 容器内调 skill-evaluator quick 模式（无头向导保守替判）
6. **评估完成**：SSH 发布报告到 HK `/data/docs/skill-evals/<task短码>-<名slug>/` → 追加评估索引页条目 → 回写 report_url → task status=completed / 释放 slot
7. **员工侧轮询**：5s → ×1.5 退避 → 封顶 30s → 状态 completed 后显示"查看报告"按钮 → 点开报告（功能地图第一屏 + 裁决 + 缺陷清单）
8. 员工关页后可凭评估索引页或 task_id 找回历史报告

## 累积 FR

### 必须实现（thin 闭环）

| ID | 功能点 |
|----|--------|
| FR01 | Brain 新增 `task_type=skill_eval`，tick 可识别并派发 |
| FR02 | Brain POST `/api/brain/skill-eval/upload` 端点（验令牌 + multer 接收） |
| FR03 | 上传硬校验：zip 魔数 / 解压 ≤50MB / 压缩比 ≤100:1 / 文件数 ≤2000 / 唯一 SKILL.md / 路径穿越 |
| FR04 | SHA-256 hash 去重（completed → 返 report_url；进行中 → 返既有 task_id；新包 → 建 task） |
| FR05 | zip 落 staging 目录（按成功 3 天 / 失败 14 天 TTL 清理） |
| FR06 | 单 slot 串行调度（MAX_CONCURRENT_SKILL_EVAL=1 环境变量控制） |
| FR07 | pending 背压：≥20 拒新提交，返回"排队已满"提示 |
| FR08 | 派发前额度预检：account2 5h 池 ≥85% / 7d 池 ≥90%，否则 pending 保留 + 飞书告警 |
| FR09 | docker-executor skillMap 新增 skill_eval 分支（sonnet / account2 / quick 模式） |
| FR10 | 容器内调 skill-evaluator quick 模式（无头向导保守替判） |
| FR11 | 评估完成后 SSH 发布报告至 HK `/data/docs/skill-evals/<短码>-<slug>/`（含 index.html） |
| FR12 | 追加评估索引页条目（`/data/docs/skill-evals/index.html`，最新 50 条） |
| FR13 | task 完成回写 report_url + status=completed |
| FR14 | 失败四态统一处理：failed(dispatch) / failed(crash) / failed(timeout) / failed(publish) → 释放 slot + 飞书告警 |
| FR15 | Brain GET `/api/brain/skill-eval/status/:task_id` 状态查询端点（返回 status / queue_position / report_url） |
| FR16 | HK nginx 新增 `location /eval-api/`：继承 Basic Auth + 注入 X-Eval-Proxy-Token + 代理至 mmv Brain |
| FR17 | 最小上传页（静态 HTML，同源挂载）：拖拽上传 / 必填校验 / 队列显示 / 轮询展示 / 查看报告按钮 |
| FR18 | 上传页归属链下拉列表（Line 00–10 + Cecelia Lines） |
| FR19 | 飞书告警：失败告警 10min 同类聚合，连败 ≥3 升级；额度不足独立告警；webhook 挂则本地日志兜底 |
| FR20 | 可观测最小集：evals 表（每次评估一行：task_id / skill_name / status / report_url / duration_ms / created_at）+ 队列深度 / 超时计数 / 拒绝计数 / 水位快照 / 失败明细 |

### 本次不做（后续 Run）

- FR38–FR53 强化项（slug 净化细节 / GBK 容忍 / 多 skill 判非法 / 索引分页 / 发布前扫密 / slot 租约 TTL / Brain 重启对账 / 上传幂等键 / staging 保护 running / UTC 统一）
- full 模式 / 失败自动重试 / 跨模型 toapis 开关 / 历史列表页美化 / 个人账号体系 / 跨模型对比

## Invariant 约束

> 以下约束不可因实现困难而妥协；出现冲突时须暂停并上报。

1. **零写死**：所有 NFR 数值（MAX_ZIP_MB / 压缩比 / timeout / 并发 / 背压阈值 / 额度预检线 / 告警线）全部从环境变量注入，禁止 hardcode
2. **令牌验证不可绕过**：不带 `X-Eval-Proxy-Token` 直打 Brain 上传端点必须返回 403，无例外
3. **Basic Auth 不可绕过**：report_url 不带 Basic Auth 请求必须返回 401
4. **路径穿越拦截**：zip 内任何条目路径含 `../` 或绝对路径必须拒绝整个包，不能只跳过该条目
5. **单 slot 强保证**：同时只能有 1 个 skill_eval 任务 running；slot 释放必须在 failed/completed 两条路径均覆盖（含异常退出）
6. **staging 与 zip 生命周期**：staging zip 不可永久留存；成功后 3 天、失败后 14 天自动清理
7. **报告永久留存**：HK 发布的报告目录不受 staging 清理影响，独立存放，不自动删除
8. **生产派发宿主 = mmv**：docker-executor 只在 mmv 上起容器；HK→mmv 链路 IP 以实施时 `tailscale status` 为准，禁止写死 IP
9. **hash 去重幂等**：同一 zip（SHA-256 相同）在 completed 状态下返回历史 report_url，不重复评估，不建新 task
10. **evals 表必须落库**：每次评估（含失败）必须在 evals 表写入一行，用于可观测；不允许内存统计替代

## NFR

| 项目 | 值（全部环境变量注入） |
|------|----------------------|
| 上传 zip 大小 | ≤ MAX_ZIP_MB=10 MB |
| 解压后大小 | ≤ 50 MB |
| 压缩比上限 | ≤ 100:1（文件数 ≤ 2000） |
| 评估超时 | SKILL_EVAL_TIMEOUT=30 min |
| 并发 slot | MAX_CONCURRENT_SKILL_EVAL=1 |
| 背压拒绝阈值 | pending ≥ 20 |
| 轮询退避策略 | 5s 起 × 1.5 指数退避，封顶 30s |
| staging 保留 | 成功后 3 天 / 失败后 14 天 |
| 报告存留 | 永久 |
| 索引页分页 | 最新 50 条（后续 Run 加分页） |
| 额度预检拦截线 | 5h 池 ≥ 85% / 7d 池 ≥ 90% |
| 额度告警线 | 5h 池 < 70% / 7d 池 < 80% |
| 飞书告警聚合 | 10 min 同类聚合；连败 ≥ 3 升级 |
| 可观测 | evals 表 / 队列深度 / 超时计数 / 拒绝计数 / 水位快照 / 失败明细 |

## 预期受影响文件

### packages/brain/
- `src/server.js` — 注册 `/api/brain/skill-eval/upload` 和 `/api/brain/skill-eval/status/:task_id`
- `src/tick.js` — skill_eval task_type 派发逻辑 + 单 slot 调度
- `src/skill-eval/` （新建）
  - `upload-handler.js` — multer 接收 / 令牌验证 / 硬校验 / hash 去重 / staging 落盘 / task 建立
  - `dispatcher.js` — 额度预检 / docker-executor 调用 / slot 管理 / 失败四态处理
  - `publisher.js` — SSH 发布报告 / 索引页追加 / report_url 回写
  - `alerts.js` — 飞书告警聚合
- `migrations/` — evals 表 DDL
- `package.json` — 新依赖（multer / node-ssh 等）

### HK 服务器（mmv → hk-vps SSH 操作）
- `/etc/nginx/conf.d/zj-docs.conf` — 新增 `location /eval-api/` 反代块
- `/data/docs/skill-evals/` — 新建目录 + index.html 骨架

### 最小上传页（静态文件，随 Brain 或独立部署）
- `packages/brain/static/skill-eval/index.html`（或 HK 独立静态目录）

## E2E 验收（Final E2E，真环境）

```bash
#!/usr/bin/env bash
# target_environment: local_api（Brain API 层验证 + 真实 HK 公网链路）
# 前置：~/incoming/日报skill-v1.2-7.7.zip 存在，Basic Auth 凭据来自 1Password CS

set -e

DOCS_URL="https://docs.zenjoymedia.media"
BASIC_AUTH="<从 1Password 读取>"
ZIP_PATH="$HOME/incoming/日报skill-v1.2-7.7.zip"

# 1. 上传（走公网 Basic Auth）
RESPONSE=$(curl -sf -u "$BASIC_AUTH" \
  -F "file=@$ZIP_PATH" \
  -F "skill_name=日报Skill-v1.2" \
  -F "source_platform=Claude" \
  -F "journey_id=36cc40c2-ba63-814c-96f3-fd3fc92cac96" \
  "$DOCS_URL/eval-api/upload")
TASK_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; print(json.load(sys.stdin)['task_id'])")
echo "task_id: $TASK_ID"

# 2. 轮询至 completed（≤30min）
for i in $(seq 1 360); do
  STATUS_JSON=$(curl -sf -u "$BASIC_AUTH" "$DOCS_URL/eval-api/status/$TASK_ID")
  STATUS=$(echo "$STATUS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")
  if [ "$STATUS" = "completed" ]; then
    REPORT_URL=$(echo "$STATUS_JSON" | python3 -c "import json,sys; print(json.load(sys.stdin)['report_url'])")
    echo "completed: $REPORT_URL"
    break
  fi
  sleep 5
done
[ "$STATUS" = "completed" ] || (echo "FAIL: timeout" && exit 1)

# 3. 报告内容断言（带 Basic Auth 可访问）
REPORT_BODY=$(curl -sf -u "$BASIC_AUTH" "$REPORT_URL")
echo "$REPORT_BODY" | grep -q "功能地图" || (echo "FAIL: 功能地图 missing" && exit 1)
echo "$REPORT_BODY" | grep -q "裁决" || (echo "FAIL: 裁决 missing" && exit 1)

# 4. 不带 Basic Auth 必须 401
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPORT_URL")
[ "$HTTP_CODE" = "401" ] || (echo "FAIL: report not protected, got $HTTP_CODE" && exit 1)

# 5. 不带令牌直打 Brain 上传端点必须 403
BRAIN_DIRECT="http://localhost:5221/api/brain/skill-eval/upload"
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -F "file=@$ZIP_PATH" "$BRAIN_DIRECT")
[ "$HTTP_CODE" = "403" ] || (echo "FAIL: Brain upload not token-protected, got $HTTP_CODE" && exit 1)

# 6. 评估索引页含本次条目
INDEX_BODY=$(curl -sf -u "$BASIC_AUTH" "$DOCS_URL/skill-evals/")
echo "$INDEX_BODY" | grep -q "$TASK_ID" || (echo "FAIL: index missing task_id" && exit 1)

echo "ALL ASSERTIONS PASSED"
```

> CI 全绿要求：Brain unit tests（skill-eval upload handler / dispatcher / publisher）+ E2E 上述脚本均通过。

## 里程碑拆解（建议执行顺序）

1. **M1 — Brain 数据层**：evals 表 migration + task_type=skill_eval + upload 端点骨架（令牌验证 + multer）
2. **M2 — 校验与去重**：硬校验五项 + SHA-256 hash 去重 + staging 落盘
3. **M3 — 调度与执行**：tick 单 slot + 额度预检 + docker-executor skillMap 扩展 + skill-evaluator quick 调用
4. **M4 — 发布链路**：SSH 发布报告 + 索引页追加 + report_url 回写 + 失败四态告警
5. **M5 — 前端与反代**：HK nginx location + 最小上传页 + 状态查询端点 + 轮询 UI
6. **M6 — E2E 验收**：跑 Final E2E 脚本确认全链路 + CI 全绿

## journey_type: internal_tool
## journey_type_reason: 内部员工使用的 skill 验收工具，不对外部客户开放，无浏览器 UI E2E 需求，验收走真实 HK 公网链路 + Brain API 断言
## target_environment: local_api
## target_environment_reason: PrepPRD 指定 local_api；E2E 验收通过公网 HK 链路 + 直打 Brain 端点完成，非 Playwright 浏览器模式
## journey_id: 36cc40c2-ba63-814c-96f3-fd3fc92cac96
## feature_id: 907eb57f-33c1-46f5-bf0b-7cfb81540063
## task_id: 52145edd-e409-4459-9490-7a02bf8e87de
