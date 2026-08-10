# Contract DoD — F1 Impact Contract & Gap Resolution Loop

- **Task ID：** d96c9fa0-83bd-40dc-b731-4f541c43af32
- **Sprint Dir：** sprints/08110022-relay-d96c9fa0
- **日期：** 2026-08-11

---

## 行为断言（BEHAVIOR）

[BEHAVIOR] change_kind 正确映射四档 → 给定 `new_capability`/`capability_change`/`bugfix`/`parameter_only` 任意合法输入时，`normalizeChangeKind()` 返回值严格等于输入语义对应的枚举值，无歧义映射

[BEHAVIOR] change_kind 与 gear 字段独立存储不互相赋值 → `harness_tasks` 表中 `change_kind` 与 `gear` 列独立存在，对 `change_kind=new_capability, gear=segmented` 的任务执行 `SELECT change_kind, gear FROM harness_tasks WHERE id=:id` 时，两列值均与写入值完全一致，不存在任何一列被另一列的值覆盖的情况

[BEHAVIOR] 非法 Impact Contract 被 Structure Gate 拒绝 → 缺少 `base_revision` 或 `affected_capabilities` 的 POST 请求到 `/api/brain/impact-contracts` 返回 HTTP 400，响应 body 包含 `error` 字段且值描述具体缺失字段名称

[BEHAVIOR] Mapper 不可判定情形不放行门禁 → 当 Mapper stub 模拟 unavailable/stale/revision_mismatch 三种状态时，Structure Gate 分别返回 HTTP 503/503/409，且 response body 中 `retryable` 字段为 `true`，绝不返回 2xx

[BEHAVIOR] CONTRACT_IMPACT_DRIFT 触发后原任务进入 blocked 状态 → 当 Diff Impact Gate 检测到未声明影响时，`gap_events` 表中新增一条 `event_type=CONTRACT_IMPACT_DRIFT` 记录，同时 `harness_tasks` 表中该任务的 `status` 字段变为 `blocked`，可通过 `GET /api/brain/tasks/:id` 验证

[BEHAVIOR] Gap 状态机单向流转且验真失败只能回到 assigned → 尝试将 gap 状态从 `verifying` 直接变更为 `open` 时，API 返回 HTTP 422；验真失败时状态变为 `reopened`，仅允许从 `reopened` 转为 `assigned`，任何其他目标状态返回 422

[BEHAVIOR] Gap 修复完成且断言 PASS 后原任务自动恢复 → 将 gap 修复任务状态更新为 `completed` 并调用断言验证接口返回 PASS 后，原任务状态从 `blocked` 自动变更为 `in_progress`，可通过 `GET /api/brain/tasks/:origin_task_id` 验证

---

## manual:bash 验收命令

```bash
# manual:bash
# 验收命令一：DevGate 三连（每段开工前必须通过）
cd /workspace
node scripts/facts-check.mjs && \
bash scripts/check-version-sync.sh && \
node packages/quality/scripts/devgate/check-dod-mapping.cjs && \
echo "PASS: DevGate 三连全部通过"

# 验收命令二：migration 编号无碰撞检查
ls /workspace/packages/brain/src/db/migrations/ | grep -E '^[0-9]+' | sort -n | tail -5
# 预期：401 和 402 不在现有列表中

# 验收命令三：change_kind 映射端到端验证
curl -s -X POST http://localhost:5221/api/brain/tasks \
  -H "Content-Type: application/json" \
  -d '{"title":"DoD test","task_type":"feature","change_kind":"bugfix","gear":"single"}' | \
  node -e "process.stdin.resume();let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{const r=JSON.parse(d);const ok=r.change_kind==='bugfix'&&r.gear==='single';console.log(ok?'PASS: change_kind='+r.change_kind+', gear='+r.gear:'FAIL: '+JSON.stringify(r));process.exit(ok?0:1)})"

# 验收命令四：非法合同被拒
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST http://localhost:5221/api/brain/impact-contracts \
  -H "Content-Type: application/json" \
  -d '{"task_id":"test","change_kind":"bugfix"}')
[ "$HTTP_CODE" = "400" ] && echo "PASS: invalid contract rejected 400" || { echo "FAIL: got $HTTP_CODE"; exit 1; }

# 验收命令五：DB 记录完整性
psql -U cecelia cecelia -c "
SELECT 
  COUNT(*) FILTER (WHERE change_kind IS NOT NULL) AS tasks_with_change_kind,
  COUNT(*) FILTER (WHERE gear IS NOT NULL) AS tasks_with_gear,
  COUNT(*) FILTER (WHERE change_kind = gear) AS cross_contaminated
FROM harness_tasks;
"
# 预期：cross_contaminated = 0
```

---

## DoD 勾选清单

### ws1 — Change Normalizer

- [ ] `packages/brain/src/impact-contract/change-kind.js` 已创建，导出 `normalizeChangeKind()` 函数
- [ ] `change_kind` 四档枚举完整：`new_capability` / `capability_change` / `bugfix` / `parameter_only`
- [ ] `change_kind` 与 `gear` 在 `harness_tasks` 表中为独立列（migration 确认）
- [ ] 无效输入返回 HTTP 400（API 层面验证）
- [ ] `change-kind.test.js` 全部测试 GREEN
- [ ] `harness_skill_relay.js` 中 change_kind 计算路径已更新
- [ ] DevGate 三连通过（facts-check + version-sync + dod-mapping）
- [ ] commit message 遵循 Conventional Commits 格式

### ws2 — Impact Contract Schema + 持久化

- [ ] `packages/brain/src/impact-contract/contract-schema.js` 已创建（Zod schema）
- [ ] migration `401_impact_contracts.sql` 已创建，包含 `harness_impact_contracts` 表
- [ ] `packages/brain/src/routes/impact-contracts.js` 已创建，含 POST/GET 路由
- [ ] 合法合同 POST → 201 + id
- [ ] 非法合同 POST → 400 + 字段错误描述
- [ ] 幂等性：同一 `(task_id, base_revision)` 重复 POST → 200 + 已有 id
- [ ] `contract-schema.test.js` + `contract-store.test.js` 全部 GREEN
- [ ] DevGate 三连通过

### ws3 — Structure Gate（含 MJ5 stub）

- [ ] Structure Gate 对 Mapper unavailable → 503 + `reason: mapper_unavailable` + `retryable: true`
- [ ] Structure Gate 对 Mapper stale → 503 + `reason: mapper_stale` + `retryable: true`
- [ ] Structure Gate 对 revision mismatch → 409 + `reason: revision_mismatch` + `retryable: true`
- [ ] 三种不可判定情形均不产生假绿（无 2xx）
- [ ] `structure-gate.test.js` 全部 GREEN（含 stub 测试）
- [ ] 测试文件中 stub 使用位置有注释标注 `// MJ5 STUB: replace with real Mapper call after MJ5 contract passes`
- [ ] DevGate 三连通过

### ws4 — Diff Impact Gate（需 MJ5）

- [ ] MJ5 合同已通过真实环境验收（前置条件，不满足则 ws4 不开工）
- [ ] 实际影响 ⊆ 声明影响时门禁通过（2xx）
- [ ] 新增影响有断言时扩展合同并通过（2xx）
- [ ] 新增影响无断言时触发 `CONTRACT_IMPACT_DRIFT`，写入 `gap_events`，原任务变 `blocked`
- [ ] `diff-gate.test.js` 全部 GREEN
- [ ] DevGate 三连通过

### ws5 — Gap Ledger（需 MJ5）

- [ ] migration `402_harness_gaps.sql` 已创建：`harness_gaps` + `gap_events` + `task_dependencies` 三表
- [ ] `packages/brain/src/impact-contract/gap-ledger.js` 已创建
- [ ] 状态机：`open → assigned → fixing → verifying → resolved` 单向强制
- [ ] 验真失败：`verifying → reopened → assigned` 路径可用，其余路径返回 422
- [ ] gap 修复完成 + 断言 PASS → 原任务自动从 `blocked` 恢复 `in_progress`
- [ ] 重复恢复回调幂等去重
- [ ] owner 不存在时进入分诊队列并触发告警
- [ ] `gap-store.test.js` 全部 GREEN
- [ ] DevGate 三连通过

### ws6 — 全链演练

- [ ] 端到端流程 DB 可查：diff → 影响裁决 → gap → 阻塞 → 修复 → 恢复，每步有记录
- [ ] Mapper stale/unavailable/revision mismatch 三种情形均不产生假绿
- [ ] 全链回归测试已纳入 `brain-ci.yml`，CI GREEN
- [ ] DevGate 三连通过
- [ ] 合并 PR 后 Brain 任务状态回写为 `completed`

---

## 依赖声明

- ws1、ws2 无外部依赖，可立即推进
- ws3 部分功能依赖 MJ5（真实 Mapper）：stub 先行，MJ5 完成后替换
- ws4、ws5、ws6 全程依赖 MJ5 `radius/digest/freshness` 合同通过真实环境验收
