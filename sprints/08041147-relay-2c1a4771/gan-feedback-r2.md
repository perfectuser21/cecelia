# GAN Reviewer Feedback — Round 2

## 收敛状态（Round 2）
- 上轮我提的阻塞问题：1 个（PRD 行 20 (b) learnings 假标签零覆盖）
- 本轮已解决：1 个（实跑验证，非信声明——见下）
- 仍阻塞：0 个
- 本轮新增阻塞问题：1 个 —— 非"更严谨"类，是验收器结构性缺陷：E2E 探针脚本 import 路径必炸（ERR_MODULE_NOT_FOUND 实测），实现正确也永远红。该缺陷 r1 合同即存在（reviewer r1 漏检，责任在我，不计 proposer 方向问题）
- 合同行数：上轮 339 → 本轮 372（增量全部来自落实 r1 阻塞项的 Step 5/B7/钉窄声明，方向 refine，非膨胀）

## r1 阻塞项落实核验（不信自觉，实读 + 实跑）

1. **Step 5 learnings 断言** ✓ — contract-draft Step 5 + E2E 步骤 6 + tests 新增 it「failure learning 文本含真实根因标签」，task_id 定位 + created_at 5 分钟时间窗防历史冒充，与 r1 feedback 示例断言逐点一致。
2. **B7 [BEHAVIOR] 真红** ✓ — 本机实跑 `NODE_ENV=test npx vitest run sprints/08041147-relay-2c1a4771/tests/` → **Tests 4 failed | 2 passed (6)**，与附录声明逐条吻合；B7 失败信息正是事故原样：`Task Failure: … [liveness_dead] … Reason: liveness_dead`，缺 never_started——钉的就是原事故伤害面。
3. **钉窄声明** ✓ — Step 5 末尾显式"只钉学习文本标签保真，不钉 requeue 通道退避/隔离策略"，generator 自选 How，无 scope 蔓延。
4. **误读句删除** ✓ — contract-dod 范围句改写为"PRD 排除的是路由逻辑；learnings 失败学习行文本保真在范围内，其 INSERT 位于 executor.js"，与新增断言无矛盾。

代码证据复核：executor.js:3958 `requeueTask(task.id, 'liveness_dead', errorDetails)` 通道参数、executor.js:1093-1094 learnings 文本取通道 reason——r1 证据链在 r2 分支依然成立，断言钉点正确。

## 本轮其他实跑核验

- B5 classifier oracle 实跑：`class=transient`，exit 1 = 真红 ✓
- INV-4 枚举复查：`never_started` 全仓库零命中，仅 executor.js 引用 process_disappeared → 真红 ✓
- INV-3 列名核对：tasks 3 列 + learnings 5 列（task_id/trigger_event/created_at/title/content）psql 实查存在 ✓
- ARTIFACT-1 exit 0、ARTIFACT-4 workflows 零 diff ✓；`suspectProcesses`/`probeTaskLiveness` 均真实从 executor.js export（tests import 面成立）✓
- E2E `bash -n` 通过、全角标点紧贴 $VAR 扫描零命中 ✓

## RUBRIC SCORES

```json
{
  "dod_machineability": 9,
  "scope_match_prd": 9,
  "test_is_red": 9,
  "internal_consistency": 8,
  "risk_registered": 8,
  "verification_oracle_completeness": 5,
  "ci_workflow_alignment": 10
}
```

- **DoD 机检性 = 9**：contract-dod 全部 BEHAVIOR/ARTIFACT/INV 条目为 vitest -t / node -e / psql / git diff 硬 exit code，附录 13 条实测记录齐全，抽测（B5/INV-4/ARTIFACT-1/4）与声明一致。
- **Scope 匹配 PRD = 9**：r1 唯一欠覆盖項（PRD 行 20 (b)）已闭合；PRD 行 18-20 三段、边界行 24-26、ASSUMPTION 两条、NFR 可观测条款均有 1:1 断言；无 PRD 之外内容。
- **Test 真红 = 9**：实跑 4 failed | 2 passed 与 Test Contract 表逐行吻合，红原因与代码现状（process_disappeared 兜底 / transient 误判 / [liveness_dead] 文本）逐条对上。
- **内部一致 = 8**：探针 heredoc 脚本在 draft Step 2 与 E2E 双份粘贴（本轮两份携带同一缺陷，恰证明双份粘贴漂移风险）；DoD 以 vitest -t 单源，可接受。
- **风险登记 = 8**：判定点登记表 2 条实登记（含误判后果+边界规则）、失败语义 3 场景、未覆盖真实链路清单 + 接缝 logic-done-pending，覆盖真实风险面。
- **Verification Oracle 完整性 = 5**：**最终验收 E2E 的真执行主链结构性必红**——步骤 3 将探针 .mjs 写入 /tmp 后用相对路径 `import('./packages/brain/src/executor.js')`，ESM 动态 import 按模块文件 URL 解析（非 cwd）→ 解析到 /tmp/packages/... → 实测 `ERR_MODULE_NOT_FOUND`。实现前 E2E 在步骤 1 就红（掩盖此缺陷）；实现后步骤 3 恒 FAIL「探针执行失败」→ generator 实现正确也过不了 final-e2e，只能死循环或非法改合同。同缺陷存在于 draft Step 2 验证命令。铁律「合同批准前记录 manual oracle 真实 exit code 并确认目标解释器确实启动」未覆盖到该脚本（附录无此行——解释器启动了但模块从未加载成功）。行为本身有 B1 vitest 工作 oracle 兜着（vitest 同进程 import 相对路径正确），故不判 0，但作为最终验收器必须修。
- **CI Workflow 对齐 = 10**：target_environment=local_api，无 GHA workflow 断言，N/A。

## 关于 PIVOT 的显式说明

r1 总分 58 → r2 总分 58（持平）。按机械规则应打 [PIVOT]，但**不打**：持平唯一原因是第 6 维新检出的缺陷携带自 r1（reviewer r1 漏检），r1 阻塞项本身已完整闭合且实跑验证。方向明确为 refine，修复量约 3 行，非方向性问题。

## VERDICT: REVISION

Round 2，阈值 7/10。维度 [verification_oracle_completeness=5] < 7 → REVISION。

### 需要 Proposer 修的（仅 1 条阻塞项）

**问题 1**（维度：Verification Oracle 完整性，当前 5 分，目标 ≥ 7）

**描述**：draft Step 2 验证命令与 E2E 步骤 3 的探针脚本写入 /tmp 后相对 import，ESM 按模块文件位置解析 → `/tmp/packages/brain/src/executor.js` 不存在 → `ERR_MODULE_NOT_FOUND`（本机实测复现）。实现正确时 final-e2e 仍恒红。

**修复**（已实测可行，不扩 scope）：
1. 探针 heredoc 改用**非引号定界符**（`<<MJS` 而非 `<<'MJS'`）让 `$PWD` 展开为绝对路径：`const { probeTaskLiveness } = await import('$PWD/packages/brain/src/executor.js');`——reviewer 本机实测 `ABS_IMPORT_OK`（NODE_ENV=test 正确路由 cecelia_test）。或等价方案：.mjs 写入 repo 根（trap 清理）。draft Step 2 与 E2E 两处同步改（或消除双份粘贴，Step 2 引用同一脚本）。注意非引号 heredoc 会展开脚本内所有 `$`，探针脚本现内容无其他 `$`，安全；若后续加内容需转义。
2. 修复后按 INV-10 铁律真跑一次修复版探针脚本并在 manual oracle 附录补一行（实现前预期：import 成功、探针执行完成、后续 REASON 断言 FAIL exit 1 = 真红——红在断言而非脚本崩溃）。

（无其他阻塞项；不列 nice-to-have。）
