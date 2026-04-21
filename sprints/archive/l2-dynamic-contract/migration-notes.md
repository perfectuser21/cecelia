# Engine L2 Dynamic Contract — Migration Notes

**版本**: 1.0.0
**日期**: 2026-04-18
**前置**: L1 静态契约（PR #2406，`packages/engine/contracts/superpowers-alignment.yaml`）
**本文件范围**: L1 → L2 迁移路径 + opt-in/enforced 切换 + 场景推演

---

## 1. L1 → L2 兼容性

### 1.1 字段兼容

L2 对 L1 契约采取 **"只加不减，不改不拆"** 策略：

| 旧字段                                | L2 变动     | 说明                                                                   |
| ------------------------------------- | ----------- | ---------------------------------------------------------------------- |
| `name`                                | ✅ 保持      | 值与顺序均不变                                                         |
| `coverage_level`                      | ✅ 保持      | 取值域不变（full/partial/rejected/not_applicable）                    |
| `engine_integration.anchor_file`      | ✅ 保持      | 路径不变                                                               |
| `engine_integration.anchor_section`   | ✅ 保持      | 不变                                                                   |
| `engine_integration.required_keywords`| ✅ 保持      | 不变                                                                   |
| `local_prompt.path`                   | ✅ 保持      | 不变                                                                   |
| `local_prompt.source_path_relative`   | ✅ 保持      | 不变                                                                   |
| `local_prompt.sha256`                 | ✅ 保持      | T1 阶段仍需填充，与 L2 独立                                           |
| `rejection_reason`                    | ✅ 保持      | 不变                                                                   |
| `notes`                               | ✅ 保持      | 不变                                                                   |
| `runtime_evidence`                    | 🆕 新增     | 仅为 10 个 full + 1 个 partial 新增，其它层级不能有此字段             |
| `_metadata.schema_version`            | ⬆️ 1.0 → 2.0 | Breaking 版本号 bump（字段新增但不破坏消费者，保守起见 bump major）    |
| `_metadata.runtime_evidence_coverage` | 🆕 新增     | L2 专属统计                                                            |
| `_metadata.invariants`                | ➕ 追加     | L1 7 条保留 + L2 8 条新增                                             |
| `_metadata.next_actions`              | ♻️ 重写     | T1 保留 + T2-T6 新增                                                  |

### 1.2 DevGate 脚本兼容

现有 `check-superpowers-alignment.cjs`（L1 T4 产出）逻辑全部保留。L2 新增的 `runtime_evidence` 字段在 L1 版本校验器里**被忽略**，不影响现有 CI。

升级步骤：

```diff
 # packages/engine/scripts/devgate/check-superpowers-alignment.cjs
 function validateSkill(skill) {
   validateAnchorFile(skill);
   validateRequiredKeywords(skill);
   validateSha256(skill);
   validateCoverageLevelConstraints(skill);
+  if (skill.runtime_evidence) {
+    validateRuntimeEvidenceSchema(skill);          // 校验字段结构
+    if (fs.existsSync(getEvidenceJsonlPath())) {
+      validateRuntimeEvidenceAgainstLog(skill);    // 对比实际日志
+    }
+  }
 }
```

`validateRuntimeEvidenceAgainstLog` 根据 `runtime_evidence.mode`：

- `opt-in` → 未满足用 `console.warn`，不 setExitCode
- `enforced` → 未满足 `process.exit(1)`

---

## 2. `mode: opt-in` 的语义与使用

### 2.1 定义

| 维度         | opt-in                                                        | enforced                         |
| ------------ | ------------------------------------------------------------- | -------------------------------- |
| 缺证据行为   | `console.warn` + 不影响 exit code                             | `console.error` + `exit 1`      |
| CI L3 状态   | pass（附 warning summary）                                    | fail                            |
| 开发者感知   | PR check 通过但 annotation 显示黄色警告                       | PR check 红叉                   |
| Rollout 速度 | 快：当天即可合入契约                                          | 慢：必须先稳定才切              |
| 风险         | 低：不会错杀无证据的 skill                                     | 中：若 skill 默认不写证据会阻塞 |

### 2.2 第一轮为什么全部 opt-in

1. `record-evidence.sh` 还没实装（T2），Stage 1/2/4 里没有任何调用点
2. 历史 branch（未接入 L2）合入 main 时不会意外红
3. 允许 /dev 逐 skill 补齐调用点，每补一处对应 skill 向 enforced 迁移

### 2.3 opt-in 阶段的产出

- CI L3 在 summary 里列出 "缺证据的 skill 清单" + "缺了哪些 event"
- 每日 `packages/engine/reports/evidence-coverage.md` 自动生成
- Brain 注册 `task_type=evidence_coverage_review` 每周一次供人类 review

---

## 3. opt-in → enforced 切换步骤

**切换条件**（8 号 L2 新增不变式）：

> "mode: enforced 切换前，必须有连续 14 天 CI L3 opt-in warning 零假阳性记录"

### 3.1 准备阶段（T-14 到 T-1）

1. 确认 `record-evidence.sh` 在该 skill 对应的 step 里已稳定调用（通过日志 sampling 验证覆盖率 >= 95%）
2. 检查近 14 天所有 PR 的 `sprints/<name>/pipeline-evidence.jsonl`，确认对应 event 齐备
3. 查 `evidence-coverage.md` 该 skill 的 "warn count" 连续 14 天为 0
4. 在 Brain 注册一条决策 `active`：`<skill_name> 切 enforced，T+0 生效`

### 3.2 切换 PR

```yaml
# superpowers-alignment.yaml
- name: test-driven-development
  ...
  runtime_evidence:
-   mode: opt-in
+   mode: enforced
    required_events: ...
```

- 标题带 `[CONFIG]`（Engine 契约改动）
- Engine 版本 bump 5 件套（见 `version-management.md`）
- feature-registry.yml 加 changelog
- PR body 附 "过去 14 天 evidence-coverage.md"

### 3.3 回滚

若切 enforced 后首周出现假阳性：

1. 反向 PR：把 `enforced` 改回 `opt-in`
2. Brain 决策标 `superseded`
3. 在 feature-registry 加 rollback changelog

**不允许直接 delete `runtime_evidence` 字段跳过校验**（会被 L2 不变式 #1 阻止）。

### 3.4 切换推荐顺序

| 顺序 | skill                           | 原因                                                                       |
| ---- | ------------------------------- | -------------------------------------------------------------------------- |
| 1    | test-driven-development         | 最机械：red + green + correlation，误差最低                                |
| 2    | verification-before-completion  | 单一 event 必出现，Implementer 必跑                                        |
| 3    | subagent-driven-development     | 两条 subagent_dispatched，由 Task tool 天然触发                           |
| 4    | writing-plans                   | 与 #3 共用 event 类型                                                      |
| 5    | requesting-code-review          | 同 #3                                                                      |
| 6    | receiving-code-review           | 同 #3 + 0+ architect                                                       |
| 7    | executing-plans                 | 含 0+ 事件，切 enforced 影响小                                             |
| 8    | brainstorming                   | 目前 0+，先补齐再切                                                        |
| 9    | dispatching-parallel-agents     | 稀有事件，零误报空间较大                                                   |
| 10   | finishing-a-development-branch  | 最稀有（正常 push 不触发），切不切差别不大，可延后                         |

---

## 4. 推演：有人故意/无意把 TDD step 删掉

**场景**: 某 PR 改 `packages/engine/skills/dev/steps/02-code.md`，把 Implementer prompt 里的 "先红再绿" 段落删了，或者把 `test-driven-development` 这个 skill 的 required_keywords 之一（如 `Condition-Based Waiting`）从正文擦掉。

### 4.1 L1 （PR #2406）会拦住吗？

- 如果删的是 **required_keywords** 对应的文字 → L1 的 `grep -q "Condition-Based Waiting"` 失败 → **CI L3 fail**，拦住
- 如果只是把实现逻辑改了但关键词还在 → L1 **拦不住**（这是 L1 的根本漏洞）

### 4.2 L2 opt-in 阶段会拦住吗？

- L1 校验按上面走
- L2 读 `sprints/<name>/pipeline-evidence.jsonl`：
  - 若 /dev 运行时实际绕过了 TDD（没写 tdd_red/green）→ opt-in 只 **warn**，不 fail
  - PR 可以合进 main（但 annotation 显示黄色警告）
- **结论**: opt-in 下**拦不住**，只是留下可观测证据供事后复盘

### 4.3 L2 enforced 阶段会拦住吗？

- L1 如上
- L2 读 pipeline-evidence.jsonl：
  - 缺 `tdd_red` 或缺 `tdd_green` → **CI L3 fail**
  - 有 tdd_green 但 test_slug correlation 不上 tdd_red → **fail**
  - exit_code 字段不符合 assert_fields 约束 → **fail**
- **结论**: enforced 下**拦住**，PR 无法合入

### 4.4 如何绕过 L2 enforced（对抗性思考）

| 攻击                                           | 防御                                                                                                             |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 伪造 jsonl 写假的 tdd_red/green event          | `record-evidence.sh` 强制自算 sha256 + exit_code，不接外部值；且 log 文件必须存在且 sha256 匹配                 |
| 手写 log 文件 + 手算 sha256 凑齐字段           | CI 会重算 `sha256(sprints/<name>/tdd-evidence/<slug>-red.log) == event.log_sha256`，不匹配则 fail                 |
| 写真的 log 但内容是 `echo "test passed"` 伪造  | 可以：但 log 内容可人工抽检。完美防御需 Stage 3 integrate 时让 CI 重跑 test_command 验证（L3 阶段不在本 Initiative） |
| 删掉 pipeline-evidence.jsonl 让 CI 找不到文件  | CI 看不到文件时根据 `mode` 决定：enforced 下**找不到文件 = fail**（不变式 #8 强制要求 jsonl 存在）              |
| 把 branch 命名成不触发 L2 的格式               | L2 校验按 `sprint-name` 文件不看 branch；Stage 1 没写 sprint-name 直接在 Stage 3 归档时失败                      |

---

## 5. 对"第一轮 opt-in"合理性的辩护

| 担忧                                       | 回应                                                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| opt-in 阶段漏洞和 L1 一样大，意义何在？    | 不同：L1 根本没运行时信号；opt-in 阶段已经在收集证据日志，只是"警告"而非"阻塞"，为 enforced 切换铺路 |
| 为什么不一步到位 enforced？                | record-evidence.sh 尚未实装（T2），且未在 /dev 各 step 里调用（T3）。一步到位会让所有存量 PR 阻塞       |
| opt-in 期间会不会把偏航合进 main？         | 会。但现在也会（L1 拦不住行为偏航）。opt-in 至少留下可查日志；enforced 切换后可溯源 main 上哪些 PR 缺证据 |
| 为什么 systematic-debugging 是 partial 也保留 runtime_evidence？ | 留 0+ blocked_escalation 观测，便于评估 BLOCKED 升级链 v2 的实际触发频次，帮助 F5 优化调用策略      |

---

## 6. 与 Harness v5.x 的关系

Harness v5.x（`harness-v3-design.md` 架构决策）是独立的 Generator/Evaluator 对抗流水线，**与 L2 正交**：

- Harness Generator 调用 /dev → /dev 写 pipeline-evidence.jsonl
- Harness Evaluator 独立跑测试，不读 jsonl
- L2 契约仅约束 **/dev 内部**的方法论执行，不影响 Harness 的对抗层

未来若 Harness 也想用 L2 证据，可加 `harness_evidence.jsonl` 单独的 schema（本 Initiative 范围外）。

---

**End of Migration Notes v1.0.0**
