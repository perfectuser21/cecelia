---
skeleton: false
journey_type: autonomous
target_environment: local_api
---
# Contract DoD — Kernel reviewer result channel 与 feedback lineage

**范围**: 最小 5 步 Golden Path；复用 `harness_attempts`、`orchestrator_decision_log` 与现有 human review authority。
**大小**: L

## ARTIFACT 条目

- [ ] [ARTIFACT] 生产代码提供 attempt-scoped result channel、严格 reviewer schema、callback structured errors 与 lineage 接线
  Test: node -e "const fs=require('fs');for(const f of ['packages/brain/src/orchestrator/result-channel.js','packages/brain/src/orchestrator/feedback-lineage.js','packages/brain/src/orchestrator/execution-contract.js','packages/brain/src/orchestrator/dispatcher.js','packages/brain/src/orchestrator/ground-truth.js','packages/brain/src/routes/harness-callback.js']){if(!fs.existsSync(f))process.exit(1)}"

- [ ] [ARTIFACT] Generator 交付 `scripts/harness/rci-reviewer-feedback-lineage.sh`
  Test: node -e "const fs=require('fs');const p='scripts/harness/rci-reviewer-feedback-lineage.sh';if(!fs.existsSync(p))process.exit(1);const c=fs.readFileSync(p,'utf8');for(const s of ['current_database()','inet_server_addr()','TEST_DATABASE_URL','RESULT_CHANNEL_PASS','CALLBACK_PASS','LINEAGE_PASS','ISOLATION_PASS','AUTHORITY_PASS'])if(!c.includes(s))process.exit(1)"

- [ ] [ARTIFACT] Brain 定义与版本同步，且不新增平行 verdict ledger
  Test: node -e "const fs=require('fs');const d=fs.readFileSync('packages/brain/DEFINITION.md','utf8');if(!/result channel|结果通道/.test(d)||!/feedback lineage|反馈血缘/.test(d))process.exit(1);const v=JSON.parse(fs.readFileSync('packages/brain/package.json','utf8')).version;if(v==='1.267.94')process.exit(1)"

## BEHAVIOR 条目

- [ ] [BEHAVIOR] [L2] attempt-scoped result channel 拒绝逃逸、symlink 与跨 attempt（Golden Path Step 1）
  动作: 枚举 dispatcher 中全部 `readOnly=true` role，为每个 role 创建 server-owned attempt 与独立 result path，再尝试合法写入、workspace 写入、路径逃逸、symlink 和跨 attempt 访问。
  预期观察: within 60s 每个 read-only role 只有当前 attempt 固定 result path 写入成功，其余全部非零；未来新增 read-only role 未自动获得 channel 时测试失败。
  验证命令: Test: manual:bash scripts/harness/rci-reviewer-feedback-lineage.sh result-channel

- [ ] [BEHAVIOR] [L2] callback error 返回精确稳定 shape 且不反射 forbidden fields（Golden Path Step 2）
  动作: 对真实 callback 依次提交合法 result、错 token、未知 attempt、wrong run/round/SHA、超限及含 secret/transcript/chain_of_thought 的 payload。
  预期观察: within 60s 合法请求 200；拒绝请求返回约定 400/401/404/409，body 精确为 `ok=false + error.key/code`，响应与日志无禁区字段/值，DB 仅合法写入。
  验证命令: Test: manual:bash scripts/harness/rci-reviewer-feedback-lineage.sh callback

- [ ] [BEHAVIOR] [L2] round 2 注入 exact prior_review 与一一对应 resolution_map（Golden Path Step 3）
  动作: 写入 round 1 reviewer authority，再经真实 ground-truth 与 dispatcher 构造 fresh proposer/reviewer TaskBundle。
  预期观察: within 60s proposer/reviewer 的 prior_review 逐字段相同，reviewer resolution_map 与 feedback id 集合一一对应；首轮与 legacy no-history 可区分，非首轮缺历史拒绝派发。
  验证命令: Test: manual:bash scripts/harness/rci-reviewer-feedback-lineage.sh lineage

- [ ] [BEHAVIOR] [L2] replay/recovery/resume 与并发 run 隔离幂等（Golden Path Step 4）
  动作: 两个 run 并发写不同 feedback；同 digest 重放、不同 digest 重放、resume/recovery 后再次读取。
  预期观察: within 60s 同 digest deduped 且 authority/log 各 1；不同 digest 409；两个 run 交叉读取为 0；stale/missing/sensitive/oversized 均零污染。
  验证命令: Test: manual:bash scripts/harness/rci-reviewer-feedback-lineage.sh isolation

- [ ] [BEHAVIOR] [L2] APPROVED 仍由 current-head 人工 authority 阻断 release（Golden Path Step 5）
  动作: 通过同一 reviewer callback 提交 REVISION 与 APPROVED，再对 `review_required=true` 的 P0 task 分别使用 stale、缺失和精确 final SHA 人工批准运行 release gate。
  预期观察: APPROVED 不创建新 ledger；stale/缺失批准时 merge/deploy 调用数为 0；精确 server-owned 批准后才各 1。
  验证命令: Test: manual:bash scripts/harness/rci-reviewer-feedback-lineage.sh authority

## 未覆盖真实链路清单

（本合同无 mock 豁免，N/A。RCI 必须使用隔离真 PostgreSQL、真实 callback/ground-truth/dispatcher/authority 接缝。）

## 失败与通过标准

- PASS：显式安全 `TEST_DATABASE_URL` 可达且库名为 `*_test|preview_*`；RCI `bash -n` 后真实执行 exit 0；五条 BEHAVIOR 全绿。
- FAIL：任何命令使用生产式默认 DSN、测试 skip、错误 body shape 不精确、禁区字段反射、跨 run 串读、stale approval 放行或人工批准前 release。
