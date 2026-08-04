# 案卷式 GAN 收敛机制 — 设计（决策 ba33fc68 / c953a263 落地）

- 日期：2026-08-04 | 任务：1dfa40f7 | Issue：ce42f68f
- 地基已上产：cost 回写(#4596)、phase/status 持久化(#4599)、thin_prd 注入(#4600)

## 拍板回放（不再讨论）

- GAN 无上限，禁任何轮数 cap（用户铁律）
- Proposer/Reviewer 各自跨轮持久对话（provider_session_id resume），互相隔离；会话丢失读案卷降级=等价
- 案卷（blocker 编号台账 + 完整反馈 + rubric 历史）落库为 SSOT，注入 bundle
- Reviewer 每轮先逐条裁定旧 blocker closure，再提新 blocker（新增必须答"上轮为何发现不了"+对应 PRD 未覆盖项）
- 代码层安全网：rubric 趋势观测（diverging/oscillating → force APPROVED + P1 告警）+ 已复活的 budget cap
- 否决案：同 session 换帽子（自审作弊）、纯失忆 Reviewer（r17 四轮实证）

## 数据模型

新表 `gan_case_file`（append-only，migration 383）：

```sql
CREATE TABLE gan_case_file (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id UUID NOT NULL REFERENCES initiative_runs(id),
  round INTEGER NOT NULL,
  author_role TEXT NOT NULL CHECK (author_role IN ('proposer','reviewer')),
  attempt_id UUID NOT NULL,
  contract_sha TEXT,
  rubric_scores JSONB,           -- reviewer 行：7 维分数
  blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- reviewer 行：[{id:"R2-1", dimension, title, detail, status:'open',
  --               why_not_found_earlier(round>1 新增必填), prd_gap}]
  -- proposer 行：[{id:"R2-1", closure:"...做了什么"}]（对上轮 blocker 的逐条关闭声明）
  feedback_md TEXT,              -- 完整反馈原文（替代推不上去的 gan-feedback-rN.md）
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (run_id, round, author_role)
);
```

案卷视图 = 按 round 升序全量行。blocker 生命周期从行序推导（append-only，无 UPDATE）。

## 数据流

1. **出口（写案卷）**：reviewer/proposer 的 result JSON 增加结构化字段：`decision.rubric_scores`（已有 reason 文本里的分数改为结构化）、`case_file: { blockers: [...], feedback_md }`。
   - `execution-contract.js` harnessResultSchema **顶层显式加 `case_file` 字段**（zod strip 教训——不加 passthrough，逐字段声明）
   - `attempt-store.js` recordCallbackTerminal 的 role projection 段（reviewer/proposer 分支）同事务 INSERT `gan_case_file` 一行（对 initiative_runs 行无第二条 UPDATE——死锁定律）
2. **入口（读案卷）**：`dispatcher.buildInputs` 对 proposer/reviewer 注入 `case_file: [...全量历轮行...]`（含 rubric 历史与 blocker 台账）；替换现在只带 2 句摘要的 `review_feedback`（保留旧字段兼容一版）
3. **会话续接**：dispatcher 派发 proposer/reviewer 时查同 run 同 role 最近 completed attempt 的 `provider_session_id`，注入 bundle `resume_session_id`；attempt-runner（fleet-worker）把它传给 codex `--resume`。恢复失败/字段缺失 → 新会话读案卷（降级等价，不算失败）
4. **趋势观测**：deriveGan 在现有三闸后加 `detectRubricTrend(caseFileRows)`：最近 3 轮 reviewer rubric——任一维度连续 2 轮严格走低=diverging；高低高/低高低=oscillating → 返回 `persist_contract_approval` 类新 action `force_approve_contract`（记 decision log reason=convergence_forced + 发 P1 告警走既有 alert 通道）。converging/insufficient_data → 继续。**无轮数 cap。**

## Skill 侧（zenithjoy-skills 独立 PR，SSOT 先行）

- reviewer：Step 2.5 改为读 bundle.case_file 做 closure 裁定表（先关旧账再开新账；新增 blocker 必填 why_not_found_earlier+prd_gap，缺任一即作废该 blocker）；结果 JSON 输出结构化 blockers+rubric_scores+feedback_md
- proposer：读 case_file；每轮必须先输出逐条 closure 声明再改合同
- 消解死规则1矛盾：rubric 机械判不变，但"作废的新增 blocker 不得计入扣分依据"写成硬规则

## 运行时依赖（ajv 类问题，并入本任务）

bundle `runtime_resources.node_deps: true`（proposer/reviewer 默认开）→ fleet workspace-manager prepare 在 clone 后若 package.json 存在则 `npm ci --no-audit --no-fund`（带缓存目录复用）。fleet-worker 改动需手动重装 launchd 侧（部署面独立，PR 里写清）。

## 分 PR 计划（串行）

- **PR-A（brain）**：migration 383 + case-file store + callback 落库 + schema 顶层字段 + bundle 注入。E2E：单测 + pg 集成（写读案卷全链）
- **PR-B（brain）**：detectRubricTrend + force_approve_contract action + P1 告警。E2E：构造三轮走低 rubric 的 decision log/case file → derive 返回 force
- **PR-C（brain+fleet）**：resume_session_id 注入与 attempt-runner --resume + node_deps prepare。E2E：attempt-runner 单测 + workspace-manager 单测
- **PR-D（zenithjoy-skills）**：proposer/reviewer skill 改造 + dist sync（"先 SSOT 后 sync 快照"铁律）
- **验收（不合并 #1581 前提不变）**：r18 用真实 PR #1581 跑 Kernel 全链，观察 GAN 带案卷收敛（blocker 逐轮递减至 APPROVED 或趋势兜底触发），Generator→Evaluator→Judge 绑定精确 SHA

## 显式不做

- 不复活 workstream（1 run = 1 合同 = 1 PR 不变）
- 不做真实用量上报（独立后续）
- Claude/Grok 的 session resume 通道本期只做 codex（fleet 现役 provider），其余降级读案卷

## PR-B 前拍板项（PR-A review 时发现，未决，不阻塞 PR-A 合并）

①**案卷槽位语义根治**：现状 `UNIQUE(run_id, round, author_role)` 假设"同一
(run,round,role) 只应该有一条权威行"，PR-A 用"终态白名单 + 触发条件收紧"
（只有 completed/completed_with_concerns、且有实质内容才落行）降低了失败
attempt 抢占槽位的概率，但没有根治——同一轮次里两个都跑到权威终态的 attempt
（例如超时后被重派、旧 attempt 才姗姗来迟地 completed）理论上仍会竞争同一
个槽位，后到的那条被 `ON CONFLICT DO NOTHING` 静默吃掉。三个候选方向，PR-B
前需要拍板一个：
  - (a) UNIQUE 加 `attempt_id`（`UNIQUE(run_id, round, author_role, attempt_id)`），
    每个 attempt 各自落一行，读侧（loadCaseFile）改成按 `(round, author_role)`
    取 `created_at`/`hop` 最新的一条作为"本轮权威行"，历史行留作审计轨迹；
  - (b) 落行动作从"attempt terminal 时"推迟到"derive.js 认可这就是本轮 verdict
    之后"（即已经在 decision log 里确认是权威 verdict 的那一刻），从源头避免
    非权威 attempt 有机会参与竞争；
  - (c) 维持现状，接受"极小概率丢一行案卷"为已知限额（案卷是收敛观测辅助，
    不是唯一真相源——决策日志 `orchestrator_decision_log` 仍然是 verdict 的
    权威记录）。

②**proposer 行 `contract_sha` 恒为 null 的锚定缺口**：`dispatcher.js buildInputs`
只给 reviewer 注入 `contract_sha`（reviewer 评审的是已经 push 好的合同分支，
sha 派发时就知道）；proposer 派发时合同还没写、更没 push，sha 要等 proposer
自己跑完 push 之后才产生，所以 PR-A 里 proposer 案卷行的 `contract_sha` 目前
永远是 null（`attemptTaskBundle(attempt).inputs.contract_sha` 对 proposer
bundle 不存在这个字段）。PR-D（skill 改造）时需要让 proposer 的 result JSON
自带其推送后的 sha（比如 `case_file.contract_sha` 或复用 `decision` 里的字段），
在 `callbackCaseFileProjection` 里补一条"result 自带 sha 优先于 bundle"的
读取顺序，否则 proposer 案卷行永远无法和它实际推送的合同版本对上号。
