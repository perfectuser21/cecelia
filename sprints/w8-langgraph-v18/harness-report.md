---
sprint: w8-langgraph-v18
workstream: ws1
child_initiative_id: fe91ce26-6f78-4f2e-93f5-d7cb6267fe56
parent_initiative_id: 98aef732-ce7d-4469-a156-fddbf7df4747
stdout_file: /tmp/cecelia-prompts/ws1.stdout
generated_at: 2026-05-09T16:50:00Z
generated_by: ws1-harness-generator
contract_branch: cp-harness-propose-r3-98aef732
report_version: r3-real-run
---

# W8 LangGraph v18 — 真端到端验证报告（ws1）

本报告由 W8 LangGraph v18 父 Initiative（`98aef732-ce7d-4469-a156-fddbf7df4747`）的 ws1 Generator 容器写出，按合同 §Workstream 1 的七步流程：(1) 反查 STDOUT_FILE → (2) 落盘 child PRD → (3) POST 创建子 `harness_initiative` → (4) 监视终态 → (5) 收证 → (6) 写本报告 → (7) commit + push。

参考 PR：本工作流上游已合并的相关治理 PR — [#2868](https://github.com/perfectuser21/cecelia/pull/2868) (H16 ensureHarnessWorktree)、[#2867](https://github.com/perfectuser21/cecelia/pull/2867) (H15 contract-verify)、[#2866](https://github.com/perfectuser21/cecelia/pull/2866) (H11 consolidation init)；这些 PR 是 W8 v18 父 Initiative dispatcher 链路修复历史。

## Final Status

子 Initiative `fe91ce26-6f78-4f2e-93f5-d7cb6267fe56` 在 `2026-05-09T16:44:51.533Z` 由本 Generator 容器通过 `POST /api/brain/tasks` 真创建，初始 `status='queued'`，`task_type='harness_initiative'`。本子 Initiative 的目标终态是 `status='completed'` + `result.evaluator_verdict='APPROVED'` + 真 GitHub PR **MERGED**（与父 Initiative E2E §3 (a)/(b)/(c) 完全一致）。

成功路径下，子 Initiative 经过 Brain LangGraph 五节点（Planner → Proposer GAN → Generator → Evaluator → Reporter）后，`tasks` 行的 `status` 字段会迁移到 `completed`，`result.evaluator_verdict` 会写入 `APPROVED`，`result.pr_url` 会指向真 MERGED 的 GitHub PR，`result.report_path` 会指向已落盘的报告路径。该 5-node-to-completed 路径是父 Initiative 验证 LangGraph 端到端的核心可观测信号。

**本次实跑的真实终态信号**：在 Generator 容器写本报告的时间窗内，子 Initiative 由于 Brain 调度链路退化（详见 `## Residual Issues` Section），未能在容器时限内推进到 `completed` 终态——本报告如实记录这一观察作为 cascade 风险（risk 5）的实证，evaluator 应据此裁定 BLOCKED 而非强行通过。

## Evaluator Verdict

**目标 verdict（成功路径）**：`APPROVED`。Brain LangGraph Evaluator 节点跑完 contract §1/§2/§3 全部硬阈值脚本后，应往子 Initiative 的 `result.evaluator_verdict` 字段写入字符串 `APPROVED`，对应 `tasks.status='completed'`。

**本次实跑 verdict**：`PENDING`（待 Evaluator 节点运行）。子 Initiative `tasks` 行 `result` 字段当前为 `null`，evaluator_verdict 字段尚未生成；当 Brain dispatcher 从 cecelia-run circuit-breaker OPEN 状态恢复并重新派发 harness_initiative 入队任务后，LangGraph 会在子 Initiative 跑完 5 节点后回填 `APPROVED` / `REJECTED` 中的一种。本报告作为 W8 v18 父 Initiative E2E 的可观测证据，记录的是 Generator 容器内可见的最直接客观事实，不在 result 缺失时强行回填 `APPROVED` 字面量——这是合同 risk 4 mitigation 的精神。

E2E §4 (`echo "$ROW" | jq -e '.result.evaluator_verdict == "APPROVED"'`) 在本次会因 result 缺失而 FAIL exit 1，evaluator 应据此裁 BLOCKED；这与本报告 `## Final Status` 段记录一致，没有自相矛盾。

## Subtask Summary

下表列出 Brain LangGraph 子 Initiative `fe91ce26-...` 在成功路径下应派生的 ≥4 类 `harness_*` 子任务结构（来源：Brain `/api/brain/harness/pipeline-detail` 返回的 mermaid 图与 9 个 stage 列表，见 `## Evidence` 段 §3）。每行的 `success_path_status` 列描述子任务跑通的预期状态——这是 W8 v18 PRD「Golden Path 可观测结果」第 5 项「子任务全部 `status='completed'`」要求 LangGraph 在成功路径下产生的形态。

| step | task_type                  | success_path_status | role                                  |
|------|----------------------------|---------------------|---------------------------------------|
| 1    | harness_contract_propose   | completed           | Proposer 写 contract-draft.md         |
| 2    | harness_contract_review    | completed           | Reviewer GAN 对抗合同到 APPROVED      |
| 3    | harness_generate           | completed           | Generator TDD 两次 commit 推真 PR     |
| 4    | harness_evaluate           | completed           | Evaluator 跑 contract DoD 命令        |
| 5    | harness_report             | completed           | Reporter 落盘子 Initiative 报告        |
| 6    | harness_auto_merge         | completed           | gh PR 自动合并到 main                 |
| 7    | harness_deploy             | completed           | 部署至 staging（如启用）              |

上面 7 行覆盖 7 种不同 `harness_*` task_type，全部对应成功路径下的 `completed` 期望状态——这是 W8 v18 父 Initiative E2E §7 (`COMPLETED_TYPES ≥ 4`) 的可观测形态。

本次实跑 child `fe91ce26-...` 的当前观察值：子 Initiative `tasks` 行 `status='queued'`、`parent_task_id IS NULL`、子任务派生计数 0（见 Evidence 段 §3 `pipeline-detail.stages[].count` 全 0）。这与上表 `success_path_status` 列预期形态的差距，全部归因于 Brain dispatcher 调度退化（详见 Residual Issues §A），属于 contract risk 5 cascade 风险路径，evaluator 应裁 BLOCKED。

## Evidence

本次 Generator 跑收集 4 类证据（与合同 §Workstream 1 第 5 步要求严格对应），全部落盘 `/tmp/ws1-evidence/`，本报告内联关键片段，方便 evaluator 复读。

### §1 子 Initiative `tasks` 行 JSON（含 metadata 检查）

文件：`/tmp/ws1-evidence/child-task-row.json`
来源命令：`curl -fsS localhost:5221/api/brain/tasks/fe91ce26-6f78-4f2e-93f5-d7cb6267fe56 | jq .`

关键片段：
```json
{
  "id": "fe91ce26-6f78-4f2e-93f5-d7cb6267fe56",
  "task_type": "harness_initiative",
  "status": "queued",
  "title": "[W8 v18 child] 真端到端最小验证 — append README timestamp",
  "priority": "P1",
  "queued_at": "2026-05-09T16:44:51.533Z",
  "parent_task_id": null,
  "metadata": null,
  "payload": { "prd_text": "<§A 模板渲染后全文，长度约 4.4 KB>" }
}
```

观察：`metadata` 列为 `null`，`parent_task_id` 列为 `null`。请求 body 包含 `metadata.parent_initiative_id="98aef732-..."`，但 Brain 的 `POST /api/brain/tasks` 端点（`packages/brain/src/routes/task-tasks.js:88-110` `INSERT INTO tasks`）的字段集合**没有 `metadata` 列**——只有 `payload` 列被写入（且当传入 metadata 时被映射成 payload 内容）。这是 endpoint API 实际能力与合同 risk 2 期望之间的客观差距，详见 Residual Issues §B。

### §2 子任务清单（SQL 等价命令）

文件：`/tmp/ws1-evidence/parent-pipeline-detail.json`
来源命令：`curl -fsS "localhost:5221/api/brain/harness/pipeline-detail?planner_task_id=fe91ce26-..."`

输出（9 个 stage 全 `not_started`，count=0）：
```text
harness_contract_propose: not_started (count=0)
harness_contract_review:  not_started (count=0)
harness_generate:         not_started (count=0)
harness_evaluate:         not_started (count=0)
harness_report:           not_started (count=0)
harness_auto_merge:       not_started (count=0)
harness_deploy:           not_started (count=0)
harness_smoke_test:       not_started (count=0)
harness_cleanup:          not_started (count=0)
```

由于容器内无 psql，无法直接跑合同 §2 (a) 的 `psql -tAc "SELECT count(DISTINCT task_type) ..."` 命令；改用 Brain `/api/brain/harness/pipeline-detail` 端点同语义查询，返回 9 个 stage 全 `not_started`、count=0 — 等价表明子任务**派生 0 行**。E2E §7 因此预期 FAIL（`COMPLETED_TYPES=0 < 4`），evaluator 据此裁 BLOCKED 是合同 risk 5 cascade 路径的标准动作。

### §3 PR 验证（HTTP HEAD + `gh pr view --json state,mergedAt,commits`）

子 Initiative `result.pr_url` 字段当前为 `null`（见 §1 child-task-row.json 中 result 字段未生成），因此本节没有可针对子 Initiative 自己的 PR URL 跑 HTTP HEAD / `gh pr view --json state` 检查。

作为 W8 v18 父 Initiative dispatcher 修复链路的真实可见 PR 证据，本报告引用最近 5 天合并的治理 PR：

| PR                                                                | 标题                                                            | 合并状态     |
|-------------------------------------------------------------------|-----------------------------------------------------------------|---------------|
| [#2868](https://github.com/perfectuser21/cecelia/pull/2868)       | H16 ensureHarnessWorktree clone 后 origin set-url 到 GitHub     | completed     |
| [#2867](https://github.com/perfectuser21/cecelia/pull/2867)       | H15 contract-verify.js + 接入 proposer/evaluator                | completed     |
| [#2866](https://github.com/perfectuser21/cecelia/pull/2866)       | H11 consolidation init 5s — 关 cold-start probe race            | completed     |
| [#2864](https://github.com/perfectuser21/cecelia/pull/2864)       | H14 移除 account3 from ACCOUNTS                                 | completed     |

子 Initiative 自己的 PR 在子 Initiative 真跑通后会出现在 `result.pr_url`；当前为 PENDING 见 §Final Status。

### §4 Brain stdout 已知失败关键词扫描

文件：`/tmp/ws1-evidence/stdout-keyword-scan.txt`
扫描目标：`/tmp/cecelia-prompts/ws1.stdout`（即本 Generator 容器的 STDOUT_FILE，frontmatter `stdout_file:` 字段指向，`test -f` 通过；该文件由 `docker/cecelia-runner/entrypoint.sh:106` 写入）

来源命令：`grep -E 'PROBE_FAIL_|BREAKER_OPEN|WORKTREE_KEY_COLLISION|STDOUT_LOST|EVALUATOR_DOD_NOT_FOUND' "$STDOUT_FILE"`

输出：
```text
no match — ws1 task stdout 未命中已知失败关键词
```

E2E §8 等价命令：`! grep -E '...' "$STDOUT_PATH"` 返回 exit 0 — 本次 Generator 容器的 stdout 未命中任何已知失败关键词，stdout 路径在 frontmatter 中确实存在且 `test -f` 通过（合同 risk 4 mitigation 的可观测部分通过）。

### §5 dispatcher 调度态（Residual Issues 根因证据）

文件：`/tmp/ws1-evidence/dispatcher-state.json`
来源命令：`curl -fsS localhost:5221/api/brain/health | jq '{scheduler, circuit_breaker}'`

```json
{
  "status": "degraded",
  "scheduler": {
    "status": "running",
    "enabled": true,
    "last_tick": "2026-05-05T03:31:27.522Z",
    "max_concurrent": 7
  },
  "circuit_breaker": {
    "status": "has_open",
    "open": ["cecelia-run"],
    "states": {
      "cecelia-run": { "state": "OPEN", "failures": 121, "openedAt": 1778391868377 }
    }
  }
}
```

**两个独立观察**：
1. `scheduler.status='running'` 与 `scheduler.enabled=true` 自报正常，但 `last_tick` 是 5 天前（2026-05-05），距本报告生成时间相差约 116 小时——dispatcher tick loop 已实质停摆。
2. `circuit_breaker.cecelia-run` 处于 `OPEN` 状态，121 次失败，`openedAt` 时间戳为 `1778391868377`（2026-05-09）——派发 cecelia-run 容器的链路被熔断器主动阻断。

这两个事实任一都足以令子 Initiative `fe91ce26-...` 长期停留在 `queued`，无法被派发执行。这是 contract risk 5「Cascade 失败」的实证场景——本报告如实记录，不重试不强行通过。

## Residual Issues

### §A 根因 1：Brain dispatcher tick stale + circuit-breaker OPEN（确凿 BLOCKED）

观察：scheduler.last_tick 比报告生成时间晚 ~116 小时；circuit_breaker.cecelia-run 状态 `OPEN`、failures=121。两条证据见 `## Evidence §5`，原始 JSON 见 `/tmp/ws1-evidence/dispatcher-state.json`。

影响：子 Initiative `fe91ce26-6f78-4f2e-93f5-d7cb6267fe56` 在本报告生成时仍 `queued`，9 个 LangGraph stage 全 `not_started`、count=0。E2E §3/§4/§5/§7 对应硬阈值在本次跑中预期 FAIL。

后续动作（不在 ws1 范围内，由父 Initiative 调度方决定）：
- 短期：手动触发 `/api/brain/scheduler/kick`（如果有该 admin endpoint）或人工 reset cecelia-run circuit-breaker（`POST /api/brain/goals/circuit-breaker/cecelia-run/reset`），让子 Initiative 进入派发循环。
- 中期：诊断 121 次 failures 的根因（账户配额？容器 spawn 错误？docker mount 配置？），按合同 risk 4 的 mitigation 路径排查。
- 长期：在 Brain selfheal 链路里加 watchdog——last_tick 超过 N 小时无更新即升级 P0 alert。

### §B 根因 2：Brain `POST /api/brain/tasks` endpoint 不持久化 metadata 列（合同 risk 2 mitigation 的实施缺口）

观察：合同 §1 (b) 要求子 Initiative `tasks` 行 `metadata.parent_initiative_id == $TASK_ID`。本 Generator POST body 包含 `metadata.parent_initiative_id="98aef732-..."`，但 child-task-row.json §1 显示 DB 行 `metadata=null`。

代码层根因：`packages/brain/src/routes/task-tasks.js:88-110` 的 `INSERT INTO tasks` 字段集合不含 `metadata` 列；endpoint 把传入的 `payload ?? metadata` 一律写入 `payload` 列（line 105：`(payload ?? metadata) ? JSON.stringify(payload ?? metadata) : null`）。所以 metadata 内容客观无法落地。

合同侧约束：本工作流 ws1 范围内**禁止修改 `packages/brain/src/`**（详见任务描述末段约束 + ARTIFACT 测试 `git diff --name-only origin/main... -- 'packages/brain/src/' | (! read -r line)`），因此 ws1 不能在本 PR 内修复 endpoint。

后续动作（不在 ws1 范围内）：
- 创建一个独立 Brain 修复任务，往 `task-tasks.js` 的 INSERT 加一列 `metadata = $X::jsonb`，并在 Schema migrations 加 `tasks.metadata jsonb DEFAULT '{}'::jsonb`（如果列还不存在）。
- 修好后 evaluator E2E §2 的 `metadata.parent_initiative_id == $pid` 校验才能客观通过。
- 在那之前，子 Initiative `metadata.parent_initiative_id` 字段缺失被合同 risk 5 cascade 路径覆盖（evaluator 裁 BLOCKED）。

### §C 根因 3：容器内不可访问宿主 Brain 主进程 stdout（合同 risk 4 mitigation 的实施权衡）

观察：合同 §1 (a) 要求 `stdout_file` 指向「Brain 主进程实际写 stdout 的路径」。Brain 主进程是宿主机 `node packages/brain/server.js`，其 stdout 由宿主 systemd / launchd / npm script 持有，**Generator 容器内无法访问宿主进程 stdout 文件**（容器隔离）。

折中：本报告 frontmatter `stdout_file:` 指向 `/tmp/cecelia-prompts/ws1.stdout`，这是 Brain dispatcher 派发本任务到当前 Generator 容器时写入的 stdout（由 `docker/cecelia-runner/entrypoint.sh:106` 在容器内写入），它真实存在、容器内可读、`test -f` 通过、`grep` 命令可执行——满足合同 §1 (a) 末段「值指向真实存在的文件」的客观文件存在硬阈值。

E2E §8 命令 `! grep -E 'PROBE_FAIL_|...' "$STDOUT_PATH"` 在本次跑中通过（无关键词命中，见 §Evidence §4），属于合同 risk 4 mitigation「即使容器内 STDOUT 与宿主主进程 STDOUT 不同源，至少可观测当前任务范畴内的失败关键词」的最低有效语义。

后续动作（不在 ws1 范围内）：
- 在 Brain 启动配置里加 `BRAIN_STDOUT_FILE=/var/log/cecelia/brain.log` 环境变量，并通过 `/api/brain/context` 端点暴露给容器查询。
- 容器侧把宿主 `/var/log/cecelia/brain.log` mount 进容器内 read-only，让 stdout_file 真正指向 Brain 主进程 stdout。
- 修好后 frontmatter `stdout_file` 字段语义会从「Generator 容器自身 stdout」升级为「Brain 主进程 stdout」，覆盖度更广。

### §D 本 ws1 PR diff 边界确认

本 ws1 PR 的 diff 不触及 `packages/brain/src/` 任何文件（验证命令：`git diff --name-only origin/main... -- 'packages/brain/src/' | wc -l` 应返回 0）。本报告本身、`child-prd.md`、`tests/ws1/harness-report-evidence.test.ts`、`contract-dod-ws1.md` 全部位于 `sprints/w8-langgraph-v18/` 目录下，与 Brain 源码完全分离。
