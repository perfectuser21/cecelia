# DoD — 刀B：cecelia 跨组件 integration nightly
- [ ] [BEHAVIOR] GitHub Actions integration-nightly.yml 存在且语法合法
  Test: manual: docker compose -f docker-compose.yml config > /dev/null（workflow 独立文件，需 gh workflow list 确认）
- [ ] [BEHAVIOR] Brain + 真 Postgres 全量 migrations → 健康就绪（tick/status 200）
  Test: CI job: 启动 Brain 容器步骤等待 90s → 超时 exit 1 硬红
- [ ] [BEHAVIOR] POST /tasks（dev 类型）→ 返回 task_id（关键路由贯通）
  Test: CI job: integration-nightly.sh ── 3. 关键路由断言
- [ ] [BEHAVIOR] PATCH /tasks/:id status=completed → GET /tasks/:id status=completed（回调贯通）
  Test: CI job: integration-nightly.sh ── 5. 回调贯通断言
- [ ] [BEHAVIOR] GET /tasks/:id 响应含 executor_kind 字段（migration 329 验证）
  Test: CI job: integration-nightly.sh ── 6. executor_kind 字段断言
- [ ] [BEHAVIOR] 红 → 自动开 [integration-red] Issue；绿 → 自动关闭
  Test: workflow_dispatch fire_test=1 proven-to-fire 验证
- [ ] CI 全绿
