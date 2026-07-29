# 小改动 PrepPRD：Acceptance 收尾三件套 + 源码归档（主理人三条件）

Brain task: ba26707e-4f5c-4207-92f8-1ac2e8e6f2bd
主理人拍板条件：超时红灯/驳回路径/验收人 owner 三条补上才算闭环自洽。

## 改什么

1. **acceptance-aging 哨兵**（F3 夜间体检项）：
   - 新文件 packages/brain/src/acceptance-aging.js：扫 acceptance_runs WHERE status IN ('pending','in_review') AND created_at < NOW()-'48h'
   - 有超时 → cecelia_events 记 P1 + Bark 告警（发主理人=验收人）；照 capture-aging 同形态（自带间隔 gate，1h 足够）
   - 挂进 scheduler-jobs.js 清单
2. **驳回自动开任务**（packages/brain/src/routes/acceptance.js results 端点）：
   - run 状态转变沿（旧≠failed → 新=failed）时自动 INSERT tasks：title=[验收驳回] <run title>，task_type=dev，priority=P1，queued 无 claim（tick 自动派发模式三）
   - payload 带 run_key/gp_id/失败 check 明细；幂等：转变沿触发 + 查重（同 run_key 已有 open 驳回任务则跳过）
3. **验收人 decision**：全域验收人=主理人本人，Bark 直响即 owner 落实（不加表字段，防过度设计）
4. **Worker 源码归档**：scratchpad 的 acceptance-test-worker → packages/notion-acceptance-worker/（src/index.ts + package.json + tsconfig + README 部署手册；node_modules/.env 不进库）
5. **注册 Ability**：「交付人工验收闭环（Notion）」挂工厂·F1（e6f803f2），kind=ability，thin/working

## 错误路径
- 哨兵 SQL 失败 → 不拖垮 tick（job 框架自带 timeout/隔离）
- 驳回任务 INSERT 失败 → 不回滚 results 事务主体（验收结果落库优先），error log + 下次转变沿不会再来（状态已 failed）→ 补偿：aging 哨兵同时扫"failed 但无对应驳回任务"的 run 一并告警
- Bark 不可用 → cecelia_events 仍落 P1（双通道）

## 验收标准
- [ ] TDD：aging 哨兵 + 驳回转变沿各先红后绿
- [ ] smoke 更新（acceptance-endpoints-smoke.sh 补两条断言）+ allowlist 已在
- [ ] DevGate 三闸 + CI 全绿
- [ ] journey_features 注册可查
