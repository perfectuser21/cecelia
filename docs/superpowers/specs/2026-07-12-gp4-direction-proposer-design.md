# GP4 direction-proposer 每周方向菜单 job — 设计 spec

> 任务 8736328e（golden-path-mode T4，DoD F11）。上游 SSOT：
> `docs/architecture/2026-07-12-golden-path-mode/architecture.md` + decisions cb6be3f6/b416bfb3。
> PrepPRD：`sprints/07121310-gp4-direction-proposer/prep-prd.md`。

## 目标

每周产出「方向菜单」候选：跨线聚合 OKR 缺口 + 推进项耗尽信号 + 直投池，经一次 LLM 汇总生成
Golden Path 候选写入 `golden_paths(status='candidate', source='strategist')`，并把「OKR 缺口全景」
写入 `working_memory key='gp_gap_panorama'` 供 GP6 晨报渲染。**不动 line-strategist 本体。**

## 方式决策：scheduler job 内联（非新 task_type）

菜单生成 = 确定性聚合（三段 SQL）+ 一次 LLM 汇总，不需要完整 dev 会话；新 task_type
`direction_propose` 需 task-router 四处登记 + executor dispatch 分支 + 并发线，接线面大收益为零。
照 ci_patrol / line-dreaming 的 scheduler 接线先例。此理由随 PR 说明（任务①要求）。

## 组件

### 新文件 `packages/brain/src/direction-proposer.js`

导出函数（照 line-dreaming.js 骨架，全部可独立测试）：

| 函数 | 职责 |
|---|---|
| `isInDirectionProposerWindow(now)` | 北京周一 05:30 窗口 = UTC 周日 21:30-21:35（`getUTCDay()===0 && getUTCHours()===21 && getUTCMinutes()∈[30,35)`） |
| `alreadyProposedThisWeek(pool)` | working_memory `gp_gap_panorama` 的 `updated_at >= NOW()-INTERVAL '20 hours'` → true（20h 去重照 line-dreaming 先例；哨兵即产物本身，无候选周也写全景故可靠） |
| `collectKrGaps(pool)` | 活跃 KR（`status IN ('active','in_progress','decomposing')`，照 tick-scheduler.js:51 先例）逐条读 `metadata.target_abilities`，join journey_features+advancement_items（复刻 ability-progress 端点 SQL，进程内直接查库不 HTTP 自调用）。缺口 reason 四类：`no_target_abilities` / `missing_refs` / `thin_ability` / `advancement_incomplete`。返回 `[{kr_id, kr_title, reason}]` |
| `collectExhaustedLines(pool)` | active journey 下所有 ability 的 advancement_items `todo+doing=0`（含零条）→ 该线耗尽。返回 `[{journey_id, journey_name}]`。只进 LLM 上下文，不进 panorama gaps（gaps 格式钉死为 KR 维度） |
| `getDirectCandidates(pool)` | `golden_paths WHERE status='candidate' AND source IN ('alex_direct','capture_triage')`。直投一等公民：已在菜单，作为 LLM 上下文防重复 + 计入缺口覆盖 |
| `proposeCandidates(llm, {gaps, exhausted, direct})` | 一次 `callLLM('thalamus', prompt, {maxTokens})`，输出 JSON `{candidates:[{title, one_liner, kr_id, journey_id, est_scale}]}`；解析照 capture-triage 的 extractJsonObject 容错模式。LLM 失败/不可解析 → 返回 `[]`（降级：确定性全景不丢） |
| `insertCandidates(pool, candidates)` | 逐条 INSERT `golden_paths(title, one_liner, journey_id, kr_id, est_scale, source='strategist')`；同 title 已存在活跃态（candidate/proposed/converged/approved/in_dev）→ skip 防重复。kr_id/journey_id 非法 UUID → 置 null（防 22P02 炸整批） |
| `writeGapPanorama(pool, gaps, coveredKrIds)` | upsert working_memory `key='gp_gap_panorama'`，`value_json={generated_at, gaps:[{kr_id,kr_title,reason}]}`（**并行约定钉死，GP6 从此 key 读**）。gaps=无候选覆盖的缺口；覆盖=本次新候选 + 直投池既有 candidate 的 kr_id 命中 |
| `maybeRunDirectionProposer(pool, {llm=callLLM}={})` | 主入口：窗口 gate → 20h 去重 → 聚合三源 → LLM → 写候选 → 写全景。返回 `{triggered, proposed, skippedDuplicates, gapsTotal, gapsUncovered, llmFailed}` |

### `scheduler-jobs.js` 登记一行

`{ name: 'direction-proposer', needsPool: true, timeoutMs: DEFAULT_TIMEOUT_MS, handler: maybeRunDirectionProposer, description: '每周方向菜单（自带北京周一05:30窗口+20h去重，候选写golden_paths+缺口全景写working_memory，GP4/T4）' }`

## 错误处理

- 三源聚合各段 `safeRows` 容错（照 line-dreaming）：单段失败留空不阻断
- LLM 失败降级：候选为空但全景照写（`llmFailed: true` 进哨兵 detail 可观测）
- 单条 INSERT 失败不阻断其他条（try/catch 逐条）

## 测试策略（vitest 单测，照 line-dreaming.test.js mock-pool 骨架）

- 窗口函数纯断言（边界四点：周日 21:29/21:30/21:34/21:35 + 非周日）
- 20h 去重 SQL 断言（含 `gp_gap_panorama` / `20 hours`）
- collectKrGaps 四类 reason 各一 fixture；collectExhaustedLines 耗尽/未耗尽
- proposeCandidates：LLM 注入 mock（合法 JSON / 不可解析 / 抛错三路）
- insertCandidates：重复 title skip、非法 UUID 置 null
- writeGapPanorama：value_json 结构断言（generated_at + gaps 数组 + 覆盖过滤）
- maybeRunDirectionProposer：窗口外不触发、去重 skip、全链 happy path
- 档位：integration（mock pool + 注入 llm），不碰真库；E2E 验证走 DoD F11 手动触发（部署后 node -e 调用主入口查产物）

## 不包含

- 晨报渲染（GP6）、圈选/批准端点（T7）、capture-triage scope 分诊（T5）
- 对抗计分 / findings_log 消费
