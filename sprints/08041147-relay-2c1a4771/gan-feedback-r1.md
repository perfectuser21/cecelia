# GAN Reviewer Feedback — Round 1

## 收敛状态（Round 1）
- 上轮我提的阻塞问题：0 个（首轮）
- 本轮已解决：N/A
- 仍阻塞：N/A
- 本轮新增阻塞问题：1 个 —— PRD 行 20 明确要求的可观测结果未覆盖（真实漏覆盖，非锦上添花）
- 合同行数：本轮 339（含 E2E 脚本与 58 条 Invariant 逐条映射；首轮基线）

## RUBRIC SCORES

```json
{
  "dod_machineability": 9,
  "scope_match_prd": 6,
  "test_is_red": 9,
  "internal_consistency": 8,
  "risk_registered": 8,
  "verification_oracle_completeness": 8,
  "ci_workflow_alignment": 10
}
```

- **DoD 机检性 = 9**：全部 BEHAVIOR/ARTIFACT 有 exit code 命令（vitest -t / node -e / psql / grep 循环），manual oracle 实测 exit code 附录 12 条齐全，无 echo 级弱检查。
- **Scope 匹配 PRD = 6**：PRD 行 20 可观测结果有三部分：(a) watchdog_kill.reason=never_started（B1 覆盖 ✓）；(b) **由此产生的 failure learning 文本含真实根因标签、不再出现 liveness_dead 假标签（零覆盖 ✗）**；(c) error_message/failure_class 不被覆盖（B2 覆盖 ✓）。(b) 是本次事故的核心伤害，漏覆盖 = 事故可原样复发。
- **Test 真红 = 9**：红证据与真实代码逐条核实吻合——executor.js 现无 never_started（checkExitReason 兜底 process_disappeared，行 337）；dev-failure-classifier.js 行 43 `/\[watchdog\]/i` 命中判 transient；vitest.config.js POSTGRES_INTEGRATION_TESTS + vitest.integration.config.js 真实存在（B6 红机制成立）。
- **内部一致 = 8**：Golden Path Step 1-7 与 E2E 脚本存在同命令双份粘贴（psql INSERT/node -e），有漂移风险但 DoD 以 vitest -t 过滤为单源，可接受。
- **风险登记 = 8**：判定点登记表 2 条实登记（含误判后果+边界规则）、失败语义声明 3 场景、未覆盖真实链路清单 + 接缝 logic-done-pending 显式登记，覆盖本任务真实风险面。
- **Verification Oracle 完整性 = 8**：非 HTTP 任务等价 oracle 已 codify（psql 值断言含 5 分钟时间窗、node exit code、vitest 真跑）；E2E 以真执行断言为主（真 INSERT + 真两轮探针 + 真 ps + psql 直查）；BEHAVIOR 8 条 ≥ 4，四类场景映射齐全。
- **CI Workflow 对齐 = 10**：target_environment=local_api，无 GHA workflow 断言，N/A。

## VERDICT: REVISION

Round 1，阈值 7/10。维度 [scope_match_prd=6] < 7 → REVISION。

### 需要 Proposer 修的（仅 1 条阻塞项）

**问题 1**（维度：Scope 匹配 PRD，当前 6 分，目标 ≥ 7）

**描述**：PRD 行 20「由此产生的 failure learning / capture atom 文本含真实根因标签（never_started 或已有 failure_class），不再出现 liveness_dead 假标签」无任何可执行断言覆盖。代码实证：
- `executor.js:3958` 探针确认死亡后调 `requeueTask(task.id, 'liveness_dead', errorDetails)`——第二参是 requeue 通道名；
- `executor.js:1093-1094` requeueTask 内部写 learnings 表（category=failure_pattern, trigger_event=watchdog_kill）的文本为 `Task Failure: … [${reason}]` / `Reason: ${reason}`，取的是**通道参数 liveness_dead**，不是 checkExitReason 的 exit reason；
- `auto-learning.js` 对 status='requeued' no-op（合同已正确声明）→ watchdog 路径产出的唯一 failure learning 就是上述这条。

结论：generator 按现合同全部断言绿灯交付后，learnings 表仍会写入 `[liveness_dead]` 假标签——原事故（urgent 学习流被假根因污染）原样复发。合同「学习文本生成属 capture_atoms 路由，PRD 明确不在范围内」是误读：PRD 排除的是 capture_atoms **路由逻辑改动**，learnings INSERT 在 executor.js（PRD 预期受影响文件第一项）内。

**修复**（可执行，不扩 scope）：
1. contract-draft Golden Path 补一步（或并入 Step 5）：never_started 任务双确认后，learnings 表该任务的失败学习行（`task_id=$TID` 且 `created_at > NOW() - interval '5 minutes'`，防历史冒充）title/content 含 `never_started`（或既有 failure_class），且**不含** `liveness_dead`。示例断言：
   ```bash
   L=$(psql "$TEST_DB_URL" -t -A -c "SELECT title || ' ' || content FROM learnings WHERE task_id='$TID' AND trigger_event='watchdog_kill' AND created_at > NOW() - interval '5 minutes'")
   echo "$L" | grep -q 'never_started' || { echo "FAIL: 学习文本缺真根因标签"; exit 1; }
   echo "$L" | grep -q 'liveness_dead' && { echo "FAIL: 学习文本仍含 liveness_dead 假标签"; exit 1; }
   ```
2. contract-dod.md 对应补 1 条 [BEHAVIOR]（同断言 vitest 版进 tests/ 文件，保持零 mock 真 PG），并补 manual oracle 实测 exit code（实现前应为真红——现文本必含 liveness_dead）。
3. 注意钉窄：只钉**学习文本标签**保真，不钉 requeue 通道的退避/隔离策略（15min 退避、3 次隔离阈值可继续按 liveness 通道语义走，PRD 范围限定「requeue/退避/隔离链路行为不变」已由失败语义声明表覆盖）——防 scope 蔓延。
4. 同步删除/改写「学习文本生成属 capture_atoms 路由，不在范围内」一句，避免与新增断言自相矛盾。

（无其他阻塞项；不列 nice-to-have。）
