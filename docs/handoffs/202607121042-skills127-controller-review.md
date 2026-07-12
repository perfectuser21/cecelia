# Code Review 报告：harness-controller v2.0.0 重写（skills#127，commit 80d2f787）

**审查任务 ID：** 由 Brain 调度（质量域，任务类型 dev）
**对象提交：** `80d2f787f58d219f804e338dc1df223f903c7d16`
**对照基线：** `bef64100`（v1.9.0，即 `b50d9ac2` 合并的版本）
**当前 main：** v2.1.0（在 v2.0.0 基础上追加 #130 tmux 自杀式关窗）
**审查时间：** 2026-07-12

---

## 一、背景与前提

- skills#127 是 `rewrite/*` 分支（decision e6c57e2f），被 auto-merge CI hook 秒合，**从未经过人工 review**，现跑在有头 session 生产链路上
- 原定嫌疑之一：issue c36326c8（evaluator 虚设）——近 7 天 relay run 全止步 generator，evaluator/judge/report 零执行
- 5dbcc309 排查已**证伪**「SKILL.md 缺 Step4-6」假设：真凶是 `harness-relay-watchdog.js` 的 PR-MERGED 判定分支（#3793 已修复），与 v2.0.0 无关

---

## 二、保留项核查（逐段 diff 对照 v1.9.0）

### Step 4 — Evaluator（真跑验收）

| 项目 | v1.9.0 | v2.0.0 | 结论 |
|------|--------|--------|------|
| 双门检查（ARTIFACT 门 + Contract Gate 反作弊） | ✓ | ✓ | 保留 |
| harness-evaluator subagent 派发 | ✓ | ✓ | 保留 |
| verdict 锚定 PR head SHA 记台账 | ✓ | ✓ | 保留 |
| FIXED 按 PASS 归一（前科语义） | ✓ | ✓ | 保留 |
| unverifiable[] 逐条兜底，禁止不核对放行 | ✓ | ✓ | 保留 |
| evaluate_verdict 上报硬性动作（PATCH relay-runs） | ✓ | ✓ | 保留 |
| fix loop 重评后同样上报 evaluate_verdict | ✓ | ✓ | 保留 |

### Step 5 — Judge（独立裁判）

| 项目 | v1.9.0 | v2.0.0 | 结论 |
|------|--------|--------|------|
| Brain judge API 主路径（curl POST /api/brain/harness/judge） | ✓ | ✓ | 保留 |
| worktree 传 HARNESS_WORKTREE_HOST 宿主路径 | ✓ | ✓ | 保留 |
| CLI 兜底（cecelia 本机不可达时） | ✓ | ✓ | 保留（格式整理，内容不变） |
| VERDICT 解析：PASS 放行，FAIL/ERROR/空 → 一律 FAIL | ✓ | ✓ | 保留 |
| judge FAIL → 带 feedback 回 Step 3 打回重写 | ✓ | ✓ | 保留 |
| 禁止：跳过 judge / 替 judge 降级 / judge 前 merge | ✓ | ✓ | 保留 |

### Step 6 — Review 门 + Merge

| 项目 | v1.9.0 | v2.0.0 | 结论 |
|------|--------|--------|------|
| review_required → Bark 通知 + 阻塞等批准 | ✓ | ✓ | 保留 |
| merge 前 SHA 锚定硬检查（确定性 bash） | ✓ | ✓ | 保留 |
| evaluator PASS + judge PASS 才许 merge | ✓ | ✓ | 保留 |
| BEHIND → gh pr update-branch ≤3 次（新 sha 重锚） | ✓ | ✓ | 保留 |
| CONFLICTING → 终局 FAIL 上报 | ✓ | ✓ | 保留 |
| staging_e2e 派生（merge 确认后，best-effort 不阻塞） | ✓ | ✓ | 保留 |

### Step 7 — Report

| 项目 | v1.9.0 | v2.0.0 | 结论 |
|------|--------|--------|------|
| harness-report 调用（Phase A/B 不变） | ✓ | ✓ | 保留 |
| initiative_runs 终态回写（phase/verdict/cost/pr_url 四字段） | ✓ | ✓ | 保留 |
| 台账 append report: done | ✓ | ✓ | 保留 |
| 确认 PR MERGED 才结束 session | ✓ | ✓ | 保留 |

### 横切纪律 / 四态 / CI 规矩

| 项目 | 结论 |
|------|------|
| 台账 bash 块（echo append + PATCH relay-runs 进度上报） | 保留（从 Step 0 抽出到横切纪律 A，内容一字不改） |
| phase-event 自报 bash 块（POST+PATCH /api/brain/harness/phase-event） | 保留（从独立节移到横切纪律 B，内容一字不改） |
| 文件接力纪律 bash 块（review-package/task-brief 脚本） | 保留（从末尾节移到横切纪律 C，内容一字不改） |
| 四态协议（DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED 处置表） | 保留（节本身无 diff） |
| CI 配套硬规矩（5条全）| 保留（末尾删了「文件接力纪律」独立节，5 条规矩本身无变化） |
| GAN 循环无硬轮数上限（禁加 MAX_ROUNDS） | 保留 |
| 合同格式硬检查（[BEHAVIOR]≥4 / ## E2E验收 / manual:bash 三项 bash） | 保留 |
| Step 0 前台点火防护（a/b 两步 bash） | 保留 |
| Step 0 恢复规则（台账 done 阶段跳过 + TDD 纪律核对） | 保留 |

---

## 三、变更项（纯结构重组，无规则新增/删除）

1. **新增「横切纪律」节（A/B/C）**：台账+进度上报 / phase-event 自报 / 文件接力，从分散于各 Step → 归拢到 Step 0 之前的独立节；各 Step 改为引用「横切纪律 B/C」，去掉重复文字
2. **新增流程主线 ASCII 图**（Step 0→7 一览，纯可读性增益）
3. **Step 0 子节化**：0.3 前台点火防护 / 0.4 恢复规则从强调块提升为 `###` 子节标题，内容压缩事故叙事（保留事件号 8e281976/#3540/#3542 引用）
4. **Step 1 验收清单合并**：从"两段+四项扩展（从属关系）"合并为"五项同权清单"，项目完全一致，格式更清晰
5. **台账记录格式移位**：从 Step 0 恢复规则内联 → 横切纪律 A 节，内容完整
6. **measure 措辞调整（不影响行为）**：
   - `evaluate_verdict 上报（1.9.0 起硬性动作）` → `evaluate_verdict 上报（硬性动作）`（去版本号）
   - `PATCH body 三个新字段` → `PATCH body 三个字段`（去"新"字）
   - `唯一的产生入口` → `唯一的任务产生入口`（无语义差异）

---

## 四、疑点

### 疑点 P1：历史事故叙事压缩（低风险）
- **现象**：Step 0.3 前台点火防护的详细事故描述（"41 秒标 terminal failed""浑然不觉继续裸跑""Brain 记账与实际执行彻底分裂"）被压缩为 "（第一种 07-06 任务 8e281976 实证）"
- **影响**：对 AI controller session 执行行为**无影响**（bash 代码块完整保留）；对人工 debugger 理解背景有轻微损失
- **结论**：可接受。细节保留在 CHANGELOG.md（v1.4.0 条目），不在 SKILL.md 里也找得到

### 疑点 P2：台账格式从 Step 0 迁到横切纪律 A（无风险）
- **现象**：Step 0/0.4 恢复规则不再包含台账格式代码块，只说"台账里标 done 的阶段直接跳过"；格式定义现在在横切纪律 A（位于 Step 0 之前）
- **影响**：读者先读到格式定义再读用法，**阅读顺序实际更合理**；AI session 顺序读下来不会遗漏
- **结论**：无回归风险

### 疑点 P3：zenithjoy-skills-dist 版本停在 1.9.0（独立问题）
- **现象**：5dbcc309 handoff 指出 "dist 停在 1.9.0（main 已 2.1.0）"，有头 session 实际读的是 1.9.0 版
- **影响**：Step4-6 逻辑两版一致（5dbcc309 已核实），不影响当前 evaluator 问题排查；但 v2.0.0/v2.1.0 的横切纪律归拢和 tmux 自杀式关窗等改进**有头 session 享受不到**
- **跟进**：任务 735d92f8 负责，不在本次 review 范围，不阻塞 verdict

### 疑点 P4：与 issue c36326c8 关系（已明确排除）
- **结论**：5dbcc309 已正式证伪"SKILL.md 缺 Step4-6"假设；真凶是 relay-watchdog.js，PR #3793 已修复
- v2.0.0 **不是** evaluator 虚设问题的嫌疑人

---

## 五、建议 Verdict

**✅ KEEP（审定保留）**

理由：
1. 逐段 diff 核实 Step4-6（evaluator/judge/merge/report）所有规则**零删除**
2. 13 个 bash 块原样保留（与 CHANGELOG 声明 "13/13 bash 块保留" 一致）
3. 全部 API 契约字符串（relay-runs / phase-event / judge / staging-e2e / skill-relay）原样保留
4. 横切纪律归拢是合理工程改进（减少散落重复，降低长 session compaction 后遗漏执行的风险）
5. 与 issue c36326c8 无关联，evaluator 虚设问题已有独立修复

**附件 Nit（不阻塞 KEEP，供主理人知晓）：**
- Nit 1：dist 刷新由 735d92f8 跟进；在此之前有头 session 读 1.9.0，行为等价但享受不到横切纪律优化
- Nit 2：若后续需要让人工 debugger 更易读历史事故上下文，可考虑在 SKILL.md 的 `###` 子节标题下加一行 "背景事故见 CHANGELOG `v<版本>` 条目" 指引

---

## 六、数据来源

- `gh api repos/perfectuser21/zenithjoy-skills/compare/bef64100...80d2f787`（完整 diff）
- `/workspace/docs/handoffs/202607121040-5dbcc309.md`（evaluator 虚设根因排查结论）
- `/workspace/packages/workflows/skills/harness-controller/SKILL.md`（cecelia repo 快照，v1.9.0）
- zenithjoy-skills main 当前版本：v2.1.0（commit bd4f8b10）

created_at: 2026-07-12T10:42:00.000Z
