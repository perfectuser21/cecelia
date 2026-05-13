# Walking Skeleton P1 — 最终盘点（2026-05-13）

## 真终点证据

**Cecelia 第一个 "派任务 → AI 写代码 → 真合 main" 的 PR**：

- **PR #2930** (W37, /decrement endpoint, 2026-05-12 22:39 UTC)
- merge commit: `c15e2d13892379419f4634b396eaaad76e6bd5bc`
- main 上多了 184 行 AI 写的代码：playground/server.js (12 行 /decrement 实现) + tests/server.test.js (106 行) + README.md (66 行)
- CI 40/40 全 SUCCESS

Walking skeleton P1 核心命题 "Cecelia 自己派任务 → AI 写代码 → 合并到 main" 真实证。

---

## 18 个 P1 fix（B1-B19, 全合 main）

| # | Fix | PR |
|---|---|---|
| B1 | reportNode 真 UPDATE tasks (status + completed_at + error_message) | merged |
| B2 | zombie reaper exempt harness 子任务 | merged |
| B3 | task_pool slot 计数对齐 | merged |
| B4 | strategy decision TTL 过期释放 | merged |
| B5 | dispatcher HOL skip | merged |
| B6 | dispatch_events 真写入 + /dispatch/recent 诊断 | #2904 |
| B7 | fleet heartbeat 可信度 | merged |
| B8 | reaper exempt 不冤杀 | merged |
| B9 | lookup 表写 graph_name | merged |
| B10 | thread_id namespace 一致 | merged |
| B11 | MAX_FIX_ROUNDS 3→20 + env override | #2924 |
| B12 | stale claim release (brain restart hole) | SQL hot fix |
| B13 | dbUpsert ON CONFLICT (graph restart 幂等) | #2927 |
| B14 | evaluator spawn env 加 PR_BRANCH + skill Step 0a + proposer ws split + planner thin slice | #2929 |
| B15 | verdict regex → extractField (JSON 嵌套解析) | #2931 |
| B17 | finalEvaluateDispatchNode 加 PR_BRANCH env | #2933 |
| B18 | await_callback 条件 edge (container exit retry) + 删 fix_round cap + generator self-verify rule | #2935 |
| B19 | fixDispatchNode 不 reset pr_url/pr_branch | #2937 |

---

## 距离"全自动 task.status=completed"还差什么

测过 W34/W35/W36/W37/W38/W39/W40/W41 — fix loop 真跑（多 round generator + container retry + pr_url 保留）但**没一次跑到 final_evaluate verdict=PASS**。

真根因（P2 范围，非 P1 阻塞）：

1. **Generator 工艺**：generator 一次写不对让 CI 全过，反复修不同 CI check（W41 fix 4 round 后仍 1 fail），永远到不了 evaluator
2. **Planner 工艺**：经常把 thin_prd 主题理解偏（我让 /ping，planner 写 /decrement → /abs → /negate；W41 直接写成了"演练脚本"）
3. **Generator/Evaluator 工艺对齐**：generator 用 vitest mock 自验（B18 加规则但 LLM 跳过），evaluator 真 curl + jq 仍能挑差异

修法（P2）：
- Anthropic 官方做法：generator **工具栈里没 vitest**（不靠 prompt 规则禁，靠工具层堵）
- per-criterion 结构化 feedback (evaluator → generator)
- generator 必须按 evaluator 同款 manual:bash 自验

---

## P1 实质完工 ✅

- 机制层：派任务 / GAN / generator / evaluator / merge_pr / fix loop 全跑通过
- 工艺层：generator/evaluator 还在 P2 打磨
- 真证据：main 上有 cecelia-bot 合并的真 PR #2930

P2 是 LLM 工艺打磨，不再是 brain 编排修补范围。
