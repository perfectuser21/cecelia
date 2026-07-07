# Sprint PRD: Skill Evaluator 内部验收台（形态B）thin 贯穿

task_id: 52145edd-e409-4459-9490-7a02bf8e87de
sprint_dir: sprints/07072314-skill-eval-service
thin_prd: true

## Golden Path

1. 员工访问 `https://docs.zenjoymedia.media/skill-eval/` → Basic Auth 通过 → 看到上传表单（zip 拖拽 + skill 名称 + 来源平台 + 归属 Line + 选填提交人）
2. 员工提交 → 前端预校验（.zip / ≤10MB / 必填齐）→ POST /eval-api/upload → 页面显示"已进队列，前面还有 N 个" + task_id
3. HK Caddy 验 Basic Auth + 注入 X-Eval-Proxy-Token → Brain `POST /api/eval/upload` 验令牌 → 硬校验（zip 魔数 / 解压≤50MB / 压缩比≤100:1 / 必含唯一 SKILL.md / 路径穿越拦截）→ hash 去重（completed 命中 → 返回历史 report_url；进行中命中 → 返回既有 task_id）→ zip 落 staging → 建 task_type=skill_eval
4. Brain tick 单 slot 串行（MAX_CONCURRENT_SKILL_EVAL=1）→ 额度预检（5h≥85% / 7d≥90%）→ docker-executor 用 account2 跑 `claude -p --model sonnet` + skill-evaluator quick 模式
5. 评估完成 → 报告 SSH 发布 HK `/data/docs/skill-evals/<task短码>-<名slug>/` → 追加评估索引页条目 → Brain 回写 report_url + status=completed；失败 → 释放 slot + 飞书告警
6. 员工页面轮询（5s 起指数退避至 30s）→ 状态 completed → 显示"查看报告"按钮 → 点开报告（功能地图 + 裁决 + 缺陷清单）
7. 员工可在评估索引页翻历史报告，或凭 task_id 直接查询

## 不包含

- FR38-FR53 强化项（slug 净化 / GBK 容忍 / 多 skill 判非法 / 索引分页 / 发布前扫密 / slot TTL / Brain 重启对账 / 幂等键 / UTC 统一）
- full 评估模式、失败自动重试、跨模型 toapis 开关、历史页高级筛选
- 个人账号体系

## Invariant 约束

N/A（journey invariants API 返回空）

## 累积 FR

N/A（journey features API 返回空，Line 00 首个 thin Sprint）

## NFR

| 配置项 | 值（全部从环境变量/配置注入，禁写死） |
|---|---|
| MAX_ZIP_MB | 10 |
| 解压上限 | 50MB / 文件数≤2000 / 压缩比≤100:1 |
| SKILL_EVAL_TIMEOUT | 30min |
| MAX_CONCURRENT_SKILL_EVAL | 1（单 slot 串行） |
| 背压拒绝阈值 | pending≥20 → 拒新提示"排队已满" |
| 轮询退避 | 5s → ×1.5 → 上限 30s |
| staging 保留期 | 成功 3 天 / 失败 14 天 |
| 报告保留 | 永久留存；索引 50 条/页分页 |
| 额度预检拦截线 | 5h≥85% / 7d≥90% |
| 额度告警线 | 5h 70% / 7d 80% |
| 飞书聚合窗口 | 10min 同类聚合；连败≥3 升级 |

## E2E 验收

```bash
# 1. 真实上传（公网，带 Basic Auth）→ 返回 task_id
TASK_ID=$(curl -sf -u "$DOCS_BASIC_AUTH" \
  -H "Content-Type: multipart/form-data" \
  -F "file=@$HOME/incoming/日报skill-v1.2-7.7.zip" \
  -F "skill_name=日报skill" -F "platform=claude" -F "line=Line00" \
  https://docs.zenjoymedia.media/eval-api/upload | jq -r '.task_id')
echo "task_id=$TASK_ID"

# 2. 轮询至 completed（≤30min）
STATUS=""; WAIT=5
until [ "$STATUS" = "completed" ]; do
  sleep $WAIT; WAIT=$(python3 -c "print(min(int($WAIT*1.5),30))")
  STATUS=$(curl -sf "http://host.docker.internal:5221/api/eval/tasks/$TASK_ID" | jq -r '.status')
done
REPORT_URL=$(curl -sf "http://host.docker.internal:5221/api/eval/tasks/$TASK_ID" | jq -r '.report_url')

# 3. report_url 返回 200 且含"功能地图"与"裁决"
BODY=$(curl -sf -u "$DOCS_BASIC_AUTH" "$REPORT_URL")
echo "$BODY" | grep -q "功能地图" && echo "$BODY" | grep -q "裁决" && echo "PASS:content"

# 4. 不带 Basic Auth → 必须 401
CODE=$(curl -s -o /dev/null -w "%{http_code}" "$REPORT_URL")
[ "$CODE" = "401" ] && echo "PASS:auth-report"

# 5. 不带 X-Eval-Proxy-Token 直打 Brain 上传端点 → 403
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -F "file=@$HOME/incoming/日报skill-v1.2-7.7.zip" \
  http://host.docker.internal:5221/api/eval/upload)
[ "$CODE" = "403" ] && echo "PASS:no-token-403"

# 6. 评估索引页出现该次条目
curl -sf -u "$DOCS_BASIC_AUTH" https://docs.zenjoymedia.media/skill-eval/index.html \
  | grep -q "$TASK_ID" && echo "PASS:index-entry"

# 7. CI 全绿（由 GitHub Actions brain-ci.yml 保证）
```

## DoD

1. Brain 新增 task_type=skill_eval + POST /api/eval/upload 端点（验令牌 / 硬校验 / hash 去重 / 建 task）
2. Brain tick 单 slot 派发（MAX_CONCURRENT_SKILL_EVAL=1 / 额度预检 / docker-executor account2 sonnet）
3. 容器内 skill-evaluator quick 模式跑通；报告 SSH 发布 HK + 索引页追加条目
4. Brain 回写 report_url + completed；失败路径释放 slot + 飞书告警（10min 聚合）
5. HK Caddy/nginx location /eval-api/ → 验 Basic Auth + 注入 X-Eval-Proxy-Token → 转发 Brain
6. 最小上传页（HTML/JS）：表单 + 队列位次显示 + 5s 退避轮询 + 查看报告按钮
7. Final E2E 7 条全部 PASS（真环境公网走通）
8. CI 全绿（brain-ci.yml）

journey_type: service_integration
target_environment: local_api
