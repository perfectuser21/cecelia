# Sprint Contract — GP锚定闭环 刀4（Brain层锚校验+机械judge核对）

> 本合同为交互式headed-session事后补录（非标准GAN流程产出），如实反映已完成并测试通过的实现。

## Golden Path

[harness_initiative任务被驱动执行] → [gp_anchor硬校验(仅zenithjoy-workspace)] → [出口：terminal failed或正常执行] ；[evaluator验收] → [runMechanicalGate GP-Anchor一致性核查(file-existence gated)] → [出口：机械闸PASS/FAIL]

### Step 1: gp_anchor 硬校验（executor.js）
**来源**: `[FROM_PRD]` — sprints/07290917-gp-anchor-cut4-brain/prep-prd.md 分支A

**可观测行为**: `task_type='harness_initiative'`且`payload.base_repo`含`zenithjoy-workspace`时，`payload.gp_anchor`缺失或格式不合法 → `_driveHarnessInitiative`返回`{ok:false,error:'missing_gp_anchor',terminal:true}`，tasks表落`status='failed'`+`custom_props.failure_class='missing_gp_anchor'`

**验证命令**:
```bash
bash packages/brain/scripts/smoke/gp-anchor-lockdown-smoke.sh
```

**硬阈值**: exit 0（L1静态断言+L2 Brain健康门+L3真实INSERT task调真实router验证落库全部PASS）

---

### Step 2: base_repo不含zenithjoy-workspace时零回归
**来源**: `[FROM_PRD]` — prep-prd.md 错误路径

**可观测行为**: cecelia自己/zenithjoy-skills等项目的harness_initiative任务不受影响，正常调用spawnSkillRelaySession

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/harness-orchestrator-lockdown.test.js --reporter=basic
```

**硬阈值**: 9/9 passed（含SC-206~209）

---

### Step 3: harness-judge.js GP-Anchor一致性核查
**来源**: `[FROM_PRD]` — prep-prd.md 分支B

**可观测行为**: `ctx.worktreePath`下存在`product-map/generated/product-map.json`时，`runMechanicalGate`核对contract-draft.md的`## GP-Anchor`声明（三形态之一或`gp-anchor: skipped`）；推进类声明的id须在product-map.json里真实存在，否则reasons含对应FAIL理由

**验证命令**:
```bash
cd packages/brain && npx vitest run src/__tests__/harness-judge-mechanical-gate.test.js --reporter=basic
```

**硬阈值**: 23/23 passed（含8条新增GP-Anchor一致性用例）

---

## Risks

| 风险 | 说明 | Mitigation |
|---|---|---|
| base_repo字段格式不一致(URL/本地路径/短名) | 实测near 30天数据显示9种不同格式 | 用`.includes('zenithjoy-workspace')`子串匹配兼容所有已知格式，而非精确匹配 |
| 误伤cecelia自己的harness_initiative任务 | task-tasks.js创建接口跨项目共用 | 仅在base_repo明确匹配zenithjoy-workspace时生效；SC-209测试用例覆盖零回归验证 |
| gp-anchor:skipped声明与GP-Anchor声明正则重叠误判 | 两者共享"gp-anchor:"前缀 | 已发现并修复：skippedDeclared优先判断，短路anchorMatch |

## 未覆盖真实链路清单
（本合同无mock豁免——所有验证均通过真实Brain实例+真实DB INSERT+真实router调用完成，见Step1验证命令的L3真环境验证段。N/A）

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期红证据 |
|---|---|---|---|
| ws1-executor | `packages/brain/src/__tests__/harness-orchestrator-lockdown.test.js` | SC-206: base_repo 含 zenithjoy-workspace 且 gp_anchor 缺失、SC-207: base_repo 含 zenithjoy-workspace 且 gp_anchor 格式不合法、SC-208: base_repo 含 zenithjoy-workspace 且 gp_anchor 合法、SC-209: base_repo 不含 zenithjoy-workspace | → 实现前 SC-206/207 判绿(未拦截)，与预期FAIL相反 |
| ws2-judge | `packages/brain/src/__tests__/harness-judge-mechanical-gate.test.js` | product-map.json 存在但 contract-draft.md 既无 GP-Anchor 段也无 skipped 声明、contract 声明推进 GP-Anchor 但 id 在 product-map.json 里查无、contract 声明格式不合法 | → 实现前这3条判绿(pass:true)，与预期FAIL相反 |

## E2E 验收
见Step 1-3验证命令，均已在本地真实环境执行通过（附Test Evidence于PR描述）。
