# Bug PrepPRD：PR 池只进不出——重复派发无幂等 + 合并后不收尸

## 症状
两仓 open PR 池只涨不消（52→需人工清理到16）。两类具体证据：
1. 同语义任务被派发两次，产出两个几乎相同的 PR（如 cp-07082309-skill-eval-daemon #3646 与
   cp-07082315-skill-eval-daemon #3647，3分钟内先后开出，标题几乎相同；同批还有 #3650 三重复）。
2. orphan-pr-worker.js:216 红色（CI failing）孤儿 PR 永远只贴 needs-attention 标签，从不关闭，
   长期堆积成待人工裁定的清单。

## 根因（重新核实，推翻 handoff 原始假设的一半）
**claim 环节不是漏洞**：`routes/task-tasks.js:379` 与 `dispatcher.js:517` 的 claim 均已是
`UPDATE ... WHERE claimed_by IS NULL RETURNING`，同一 task_id 不可能被两个 runner 同时拿到。

**真实根因是两条独立路径**：
1. **语义级重复**：两个 task_id 不同、但描述同一件事的任务行都合法地各自通过了 claim 并被派发——
   派发前没有"这件事是不是已经在办/办过"的查重（无论是查 GitHub open PR 还是查 dev_records）。
   watchdog（`harness-relay-watchdog.js:48` `_discoverPrFromGithub`）已经有这类查重逻辑，但只用于
   watchdog 的重点火场景，不在初始 tick dispatch（`dispatcher.js` 选取候选任务时）复用。
2. **合并后不收尸**：`orphan-pr-worker.js` 红色分支（line 216-217, ciStatus==='failure'）只
   `labelPr`，没有超期关闭；且全文件 `grep superseded` 为空，没有"发现同任务已有 MERGED PR → 关闭
   败者"的逻辑，PR 池没有出口。

## 修法

### 刀1：统一派发前置语义查重闸（漏洞1）
- 抽出 `harness-relay-watchdog.js` 里 `_discoverPrFromGithub`（按分支名 short-id 匹配 GitHub PR）
  的查重逻辑为共享函数，供 `dispatcher.js` 派发候选任务前调用。
- 仅对 `task_type` 属于 dev/harness 类的任务启用（避免拖慢非代码类任务派发）。
- **fail-open**：`gh` 调用失败/超时 → 记 warning，不阻塞派发（初始派发主路径不能因 gh 挂掉而全体停摆，
  这与 watchdog 重点火场景的 fail-closed 语义不同，故不能直接复用同一保守策略）。
- 匹配优先级：确定性指纹（sprint_dir / branch short-id）优先于标题模糊匹配；仅 GitHub state
  为 OPEN 或 MERGED 才算命中，CLOSED 不算（放过合法重试）。

### 刀2：orphan-pr-worker 红孤儿收尸 + superseded 检测（漏洞2）
- 红色（`ciStatus==='failure'`）孤儿超过 N 天（复用 `ORPHAN_PR_AGE_THRESHOLD_HOURS` 同款 env 配置
  模式，新增 `ORPHAN_PR_STALE_CLOSE_DAYS`，默认 7）→ `gh pr close` + 留可追溯评论，不删分支（可恢复）。
- **豁免机制**：PR 带 `keep` label → 永不自动关（人工点名要救的 PR 用这个逃生阀，如 handoff 里
  ZJ #1194/#1155）。
- superseded 检测：仅用确定性证据（同 branch short-id 已存在一个 MERGED 状态的 PR）→ 关闭当前
  这个败者 + 评论标注被哪个 PR 取代；语义相近但无确定性证据的不自动关，只贴 `needs-attention`
  留给人工。

## 关联上下文
- Brain issue：6fc3bfe8-73fb-4e0c-a2b5-e146b9bbb221
- Handoff：docs/handoffs/202607131516-ci-audit-cleanup-handoff.md
- 相关历史决策：zombie-reaper-false-kill-dev-tasks（同类"自动化误杀活任务"教训，本次刀2的豁免/
  确定性证据设计沿用同一原则：宁可少关，不可错关）

## Regression Test 计划
1. 派发幂等：mock 两个 task 行（不同 task_id，语义指纹相同，均已 claim）→ 断言派发查重闸命中
   已存在的 GitHub PR 后跳过第二次派发（不产出第二个 PR）。
2. 红孤儿超期关：mock `classifyChecks` 返回 failure + `pr.ageDays > threshold`、无 keep label
   → 断言调用 `gh pr close`。
3. superseded 关闭：mock 同 branch short-id 已有 MERGED PR → 断言当前 open PR 被关 + 评论内容含
   "superseded by"。
4. 豁免不关：mock 红孤儿带 keep label → 断言不调用 close。

> 守卫种类：均为逻辑接缝（纯函数 + mock gh/pool），CI test 即可，不需要环境类自检。

## 验收标准
- [ ] failing test 先 commit（commit-1）
- [ ] 修复代码让 test 变绿（commit-2）
- [ ] 已为本 bug 配 proven-to-fire 守卫（regression test 本身，故意跑一次看它报红）
- [ ] CI 全绿
- [ ] `node scripts/facts-check.mjs` 通过（Brain 核心改动 DevGate）
