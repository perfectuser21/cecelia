# Sprint PRD — Skill Evaluator 内部验收台（thin 贯穿）

task_id: 52145edd-e409-4459-9490-7a02bf8e87de
sprint_dir: sprints/07072314-skill-eval-service
journey: Line 00 ZenithJoy 运营中枢
journey_type: internal-tool
target_environment: mmv（生产派发）+ hk-vps（HK 网关/报告发布）

---

## Invariant 约束

1. **单 slot 串行**：Brain 同时只跑 1 个 skill_eval 任务（MAX_CONCURRENT_SKILL_EVAL=1）
2. **背压拒绝**：pending skill_eval ≥ 20 → 拒新，返回"排队已满"，不建 task
3. **额度预检**：派发前验 5h Sonnet 池 ≥ 85% 且 7d 池 ≥ 90%；不足 → 拦截 + 飞书告警，task 保持 pending
4. **硬校验五件套**：zip 魔数 / 解压 ≤ 50MB / 压缩比 ≤ 100:1（≤2000 文件）/ 必含唯一 SKILL.md / 无路径穿越
5. **代理令牌隔离**：HK 反代注入 X-Eval-Proxy-Token；Brain 端点验此令牌（403 否则）；令牌存 1Password CS + ~/.credentials/
6. **hash 去重**：zip SHA-256 命中 completed → 直返历史 report_url；命中 in_progress → 合流返回既有 task_id，不新建
7. **报告 Basic Auth**：report_url 不带 Basic Auth → 401；报告文件永久留存
8. **超时释放**：评估超 30min → 强杀容器，释放 slot，飞书告警
9. **全配置注入**：MAX_ZIP_MB / SKILL_EVAL_TIMEOUT / pending 上限等全部环境变量注入，禁写死
10. **飞书聚合**：同类告警 10min 内合并；连败 ≥ 3 次升级；webhook 挂 → 本地日志兜底

---

## 累积 FR

| # | 功能需求 | 优先级 | 归属层 |
|---|----------|--------|--------|
| FR01 | Brain 新增 task_type=skill_eval；skill_eval_tasks 子表（zip_hash/zip_path/skill_name/platform/report_url/submitter） | P0 | Brain DB |
| FR02 | POST /api/brain/skill-evals/upload 端点：验 X-Eval-Proxy-Token → 硬校验 → hash 去重 → zip 落 staging → 建 task | P0 | Brain API |
| FR03 | GET /api/brain/skill-evals/:task_id/status 端点：返回 status/position/report_url | P0 | Brain API |
| FR04 | Brain tick：skill_eval 单 slot 调度，pending→running→completed/failed 状态机 | P0 | Brain tick |
| FR05 | docker-executor 扩展：skill_eval job 类型，选 account2，调 skill-evaluator quick 模式（无头向导保守替判） | P0 | executor |
| FR06 | 报告 SSH 发布：scp 到 hk-vps /data/docs/skill-evals/<短码>-<名slug>/；追加评估索引页条目（50 条分页） | P0 | 发布 |
| FR07 | HK Caddy/nginx：/eval-api/ 路径继承 Basic Auth + 反代到 Brain 上传端点，注入 X-Eval-Proxy-Token | P0 | HK 网关 |
| FR08 | 最小上传页（/eval-api/upload.html）：zip 拖拽 + skill 名称 + 来源平台 + 归属链选择 + 提交人（选填）；前端预校验 | P0 | 前端页 |
| FR09 | 轮询 UI：5s 起 ×1.5 指数退避封顶 30s；显示排队位次；completed → "查看报告"按钮 | P0 | 前端页 |
| FR10 | 错误显示：上传校验失败/排队已满 → 页面红字具体原因 | P0 | 前端页 |
| FR11 | 飞书告警：额度不足 / 容器失败 / SSH 发布失败 / 超时 / 连败升级（10min 聚合） | P1 | 告警 |
| FR12 | staging 清理：成功 3 天 / 失败 14 天自动删除 zip | P1 | Brain |
| FR13 | 最近评估列表：员工凭 task_id 或列表找回历史报告 | P1 | 前端页 |

---

## NFR

- MAX_ZIP_MB=10 / 解压上限=50MB / 压缩比=100:1 / 文件数≤2000
- SKILL_EVAL_TIMEOUT=30min
- 背压：pending≥20 拒新
- 轮询：5s→×1.5→30s 封顶
- staging 保留：成功 3d / 失败 14d；报告永久留存
- 索引页 50 条分页
- 额度预检：5h≥85% / 7d≥90%（告警线 70%/80%）
- 飞书 10min 同类聚合，连败≥3 升级
- 账号：派发宿主 mmv，account2（~/.claude-account2/.credentials.json）

---

## 验收标准（Final E2E）

- [ ] 真实上传 ~/incoming/日报skill-v1.2-7.7.zip（公网 /eval-api/upload + Basic Auth）→ 返回 task_id
- [ ] 轮询至 completed（≤30min）
- [ ] curl report_url → HTTP 200，正文同时含"功能地图"与"裁决"
- [ ] 同一 report_url 不带 Basic Auth → 401
- [ ] 不带 X-Eval-Proxy-Token 直打 Brain 上传端点 → 403
- [ ] 评估索引页出现该次评估条目
- [ ] CI 全绿

---

## 实施顺序

1. Brain DB migration（skill_eval_tasks 子表 + task_type）
2. Brain API（upload + status 端点）
3. Brain tick（单 slot 调度）
4. docker-executor 扩展（skill_eval job）
5. HK 网关配置（Caddy + nginx /eval-api/）
6. 报告发布脚本（SSH scp + 索引追加）
7. 飞书告警模块
8. 上传页 + 轮询 UI（静态 HTML 托管到 HK docs）
9. E2E 验收
