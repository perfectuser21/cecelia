# Architecture: AI 自提 Golden Path 模式（GP loop 立项）

> /architect Mode 2 产出（2026-07-12）。依据 decisions `cb6be3f6`（七解法定稿）/ `b416bfb3`（报备制分层）/
> `584a5946`（L2 无超时）/ `467ced6b`（验货队列拍板）；修订 `57d296a1`（全自动派工加 scope 分层）。
> 规格页：https://docs.zenjoymedia.media/strategist-node-v2-spec/ ·
> loop 总览：https://docs.zenjoymedia.media/ai-golden-path-loop/
> 前置扫描：system_modules 已刷新至 195 模块（2026-07-12，91 张卡片增量）。

## 概述

把「AI 自己提出新 Golden Path → 人圈选批审 → harness 实现 → 验收回流」这条循环接进现有作战体系。
方向发现（每周菜单）补上系统目前缺失的"该开哪条新方向"产出口；批审桌（晨报军师节 v2）是人出现的
主舞台；报备制给低风险 GP 留 24h 否决窗快速通道；capture-triage 的 scope 分诊把 T16 全自动派工
收编进同一治理框架（repair 级维持自动、capability 级投菜单）。

## 影响分析结论（三路侦察实证，2026-07-12）

**规格页引用的"既有设施"三件中两件不存在、一件不可复用本体——设计按真实现状出**：

| 规格假设 | 代码现实 | 对策 |
|---|---|---|
| 验货台段"既有 467ced6b 不动" | battle-report.js 六段里**没有**验货台；✅/❌ 回写端点为零；❌→invariant 链路为零；飞书只发纯链接 | 拍板回路整体作为 T7 从零建（API 端点+战情室交互），飞书富卡片显式范围外 |
| 真机验收走"Desktop Arbiter 租约" | 代码零命中，仅 C1 设计草案（rog session-1 通道）+ dev skill `windows_wechat` 枚举 | 真机验收员整体移出本 initiative（见"不包含"），首轮 GP 用 demo+staging 档验收 |
| 方向圈选段复用 line-strategist | line-strategist 是**单线原子决策**（命中即停、无菜单概念），职权边界已冻结 | 新建 direction-proposer skill + 每周 scheduler job（照 ci_patrol 骨架），只复用接线模式不动本体 |

其余关键现实：`golden_path_proposal` 全仓零命中（全新 task_type，接线面=task-router 4 处+executor
dispatch 分支+harness-skill-relay loadSkill 写死点+dispatcher 并发线）；三镜头对抗未沉淀成 skill
（试点是会话内手工编排）；朋友圈试点提案正文在另一会话 scratchpad，需抢救入库。

**裁决：GOOD**（无重复功能；golden_path 表复用冲突已识别并在关键决策中解决）。

## 数据模型变更

### 新表 `golden_paths`（GP 蓝图级实体 + 生命周期状态机）

**为什么新建而不复用现有 `golden_path` 表**：现有表是任务级累积 FR 台账
（owner_task_id/order_no/feature_id，九要素 T2 已接 4 条终态路径在活跃写入），与"路径级提案实体"
语义不同、粒度不同、生命周期不同，强行复用会把两套状态机搅在一行。现有表**一字不动**。

```sql
CREATE TABLE golden_paths (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  one_liner     text NOT NULL,              -- 菜单行：一句话
  journey_id    uuid REFERENCES journeys(id),
  kr_id         uuid,                        -- 挂哪个 OKR/KR 缺口（goals 表）
  est_scale     text,                        -- 预估规模（人话，如 "约2周产能/3个PR"）
  status        text NOT NULL DEFAULT 'candidate'
    CHECK (status IN ('candidate','proposed','converged','approved','in_dev',
                      'delivered','expired','rejected','blocked_gate','superseded')),
  source        text NOT NULL DEFAULT 'strategist'
    CHECK (source IN ('strategist','alex_direct','capture_triage')),  -- 解法①：直投一等公民
  proposal_doc  text,                        -- 收敛后提案正文（markdown）
  demo_url      text,
  judgment_refs uuid[],                      -- 批准时写入的 decisions(category=judgment) id
  findings_log  jsonb DEFAULT '[]',          -- 解法③：对抗 findings 台账（含 REFUTE 归属，本期只存不算分）
  auto_release  boolean DEFAULT false,       -- 走报备制（b416bfb3 五条件）
  veto_deadline timestamptz,                 -- 报备 24h 否决窗截止
  approved_at   timestamptz,
  review_after  timestamptz,                 -- 保质期（默认 approved_at + 14 天，语义对齐 decisions.review_after）
  status_reason text,                        -- rejected/blocked_gate 一句话原因（水位段展示）
  proposal_task_id uuid REFERENCES tasks(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_golden_paths_status ON golden_paths(status);
```

状态机（解法⑦，活清单原则：任何状态可见可捞回）：
```
candidate ──圈选──▶ proposed ──对抗收敛──▶ converged ──批准/报备生效──▶ approved ──开工──▶ in_dev ──▶ delivered
    │                   │                      │  └─否决──▶ converged（回批审）
    └─每周未选顺延        └─对抗失败──▶ rejected  └─批审拒──▶ rejected
approved 超 review_after 未开工 ──delta检查有漂移──▶ expired（重上批审段）
任何状态 ──被新 GP 取代──▶ superseded；──闸门卡住──▶ blocked_gate
```

### 既有表轻改

- `decisions`：无 schema 变更。批准判定点写 `category='judgment'` + `review_after`（既有列），
  `reason` 内嵌 `gp:<golden_paths.id>` 便于对账（模式照 capture-triage 的 `atom:<id>` 先例）。
- `capture_atoms`：无 schema 变更。scope 分诊结果写进 `ai_reason` 前缀（`[triage:capability]`）。

## API 变更（全部挂 routes/，新文件 `routes/golden-paths.js`）

| 端点 | 用途 |
|---|---|
| `GET /api/brain/golden-paths?status=` | 列表（晨报五段+水位段取数） |
| `POST /api/brain/golden-paths` | 建 candidate（direction-proposer / Alex 直投 / capture-triage capability 路由三处调用） |
| `POST /api/brain/golden-paths/:id/select` | 圈选：candidate→proposed + 自动建 `golden_path_proposal` 任务（批规模闸：查 capacity-budget，单批 ≤2 周产能对应 GP 数，超限拒并提示顺延） |
| `POST /api/brain/golden-paths/:id/approve` | 批准：判定点写 decisions(judgment,review_after=14d) + status→approved + 冻结 proposal_doc + 注册 harness 任务 |
| `POST /api/brain/golden-paths/:id/veto` | 否决：报备中→converged 回批审；批审中→rejected（带 status_reason） |
| `PATCH /api/brain/golden-paths/:id` | 状态机内部流转（controller/tick job 用；CHECK 非法流转拒） |

## 模块变更

| 模块 | 变更 | 说明 |
|---|---|---|
| `migrations/33x_golden_paths.sql` | 新建 | 表+索引+状态 CHECK |
| `routes/golden-paths.js` | 新建 | 上表 6 端点 |
| `gp-shelf-life.js` + scheduler job | 新建 | 保质期 delta 检查：approved 超 review_after 未 in_dev → 轻量现状复查（关键探索断言重验）→ 有漂移置 expired；报备 veto_deadline 过期未否决 → 自动生效 approved（b416bfb3） |
| `task-router.js` | 修改 | `golden_path_proposal` 四处登记（VALID_TASK_TYPES:16-62 / SKILL_WHITELIST:73 / LOCATION_MAP:298 区 'us' / CAPABILITY_REQUIREMENTS:378 区 ['has_git']） |
| `executor.js:3218/2958` | 修改 | dispatch 分支扩 `golden_path_proposal` 复用 runHarnessInitiativeRouter；orchestrator 硬校验放行 |
| `harness-skill-relay.js:162` | 修改 | loadSkill 按 task_type 选 controller（`golden_path_proposal`→`golden-path-controller`） |
| `dispatcher.js:82-99` | 修改 | 新类型纳入同一并发上限防线 |
| `direction-proposer.js` + scheduler job | 新建 | 每周窗口（北京周一 05:30，晨报前）：跨线读 KR 缺口（ability-progress 对账端点）+ advancement 耗尽信号 + capture 直投池 → 产出候选写 golden_paths(candidate)，附「OKR 缺口全景」（无候选覆盖的缺口显式列出，解法①防自证） |
| `capture-triage.js` | 修改 | verdict 增加 scope 维度（repair/capability）：line_backlog+repair 维持 T16 自动派工；line_backlog+capability → 写 golden_paths(candidate, source='capture_triage')，不再直接建任务（修订 57d296a1，落新决策引用之） |
| `battle-report.js` | 修改 | 军师节 v2 五段（照第⑥段三处对称模式）：圈选段（每周，candidate 行+缺口全景）/ GP 批审段（converged 行，新型判定点排前）/ 报备段（auto_release 行+否决窗倒计时+昨日 `[自动派工]` 台账）/ 水位段（GROUP BY status 一行）/ 需动作条目 ≤7 硬截断（新型判定点>首次放行>圈选>抽检优先级，溢出顺延显示堆积水位） |
| zenithjoy-skills：`golden-path-controller` + GP 版 proposer/reviewer | 新建（skills repo 另 PR） | 复用 harness-controller 横切纪律（台账 append-only/phase-event 自报/文件接力/四态出口）；替换 Step 3-6 为"探索→提案→三镜头分级扇出对抗（内部小改 1v1，碰真机/客户/钱三镜头）→收敛→HTML demo→PATCH golden_paths status=converged+findings_log"；无 MAX_ROUNDS 纪律保持；朋友圈试点 v2.1 提案文档先抢救入 repo 作为 golden 样例 |
| Dashboard `ReportDetailPage` | 修改 | 战情室报告页加最小交互：圈选（勾选 candidate 编号提交 /select）、批准/否决按钮（converged/报备行）——首版拍板通道走 Dashboard（HK 代理已通手机可达），飞书保持纯链接 |

## 关键决策

| 决策 | 选项 A | 选项 B | 选择 | 理由 |
|---|---|---|---|---|
| GP 实体存哪 | 复用 golden_path 表 | 新表 golden_paths | **B** | 现有表是任务级 FR 台账且在活跃写入（九要素 T2），语义/粒度/生命周期都不同；"能复用不新建"不适用于语义错配 |
| 方向菜单怎么产 | 扩 line-strategist | 新 direction-proposer job | **B** | line-strategist 职权=单线原子决策已冻结；菜单是跨线全局视角，节律（每周）也不同 |
| 菜单池存哪 | 独立菜单表 | golden_paths status='candidate' | **B** | 统一状态机，圈选=状态流转，零平行表 |
| 拍板通道首版 | 飞书富卡片交互 | Dashboard 战情室按钮+API | **B** | 飞书当前只发纯链接且 bot 权限缺 im:message:send；Dashboard HK 代理已通手机可达；富卡片留后续 |
| T16 自动派工 | 保持无差别自动 | scope 分层收编 | **B** | repair 级自动派工=报备制五条件的退化形态（护栏逐条对应）；capability 级借道直发=绕过批审的后门，收编为菜单输入源（修订 57d296a1） |
| controller 复用方式 | harness-controller 加 mode 参数 | 新 golden-path-controller skill | **B** | 骨架 Step 3-6 整段要换（产物是 demo+提案不是 PR），mode 分支会把两套流程搅在一个 SKILL.md；横切纪律以复制+引用方式复用 |
| 真机验收员 | 纳入本 initiative | 另立 initiative | **B** | Desktop Arbiter 不存在需从零设计；GP 首轮 demo+staging 档可验收；C1 草案对接约定写入本文档即可，不阻塞 loop 首转 |

## 不包含（范围外）

- **真机验收员**（rog session-1 smoke runner+铺货 gate+设备排期）——另立 initiative，待 GP loop 首转后
- 飞书富卡片交互 / 抽检棘轮自动收紧（解法③⑤的棘轮本期只留 findings_log 数据接口，不算分不收紧）
- 对抗计分（proposer REFUTE 双向记账）——findings_log 只存不算
- 镜头 prompt 定期轮换机制
- 验货台段的"逐件 ✅/❌ 昨日交付展示"完整体（467ced6b 全量落地是独立工程；本次只做 GP 相关的批审/报备/圈选回路）

## 测试策略

- migration/routes：vitest + 真 postgres 集成（状态机非法流转拒、圈选建任务、批准写 judgment、否决回流）；CI 两闸（smoke-allowlist 登记 + routes 同名 test 配对）
- scope 分诊：capture-triage 单测扩 repair/capability 两路 fixture（复用既有 cheap-rule 测试骨架）
- battle-report：渲染契约断言（五段空态渲染"暂无"而非缺失=B1；9 条 fixture 验证 ≤7 截断=B4）
- E2E proven-to-fire：一条真实 candidate 走完 圈选→proposed→（跳过对抗直接置 converged）→批准→judgment 落库+harness 任务注册，全链 DB 可查（对应 DoD B2/B3）
- skills repo：golden-path-controller 走 eval（skill 五步流程）

## 实施记录

（Mode 3 验收时追加）

## 实施记录（/architect verify，2026-07-12 15:38 北京）

**总体裁决：PASS**（两项备注见下）。GP1-7 全部 merged：#3779（底座）/#3780（接线）/zjs#131（controller 三件套）/#3785（方向菜单）/#3784（scope 分诊）/#3783（晨报五段）/#3787（拍板回路）。

**验收明细**：F1/F3/F4/F5/F6 生产活体实测通过（探针数据已清）；F2/F7-F12 代码级+CI 集成测试验证；F13 修订决策已落库；F14 朋友圈样例入 zjs examples；I1 CI Path 4 E2E 全过 + 本地活体复走；I2 两闸全绿；A1-A3 无偏离。

**实施偏差与备注**：
1. initiative 级 code_review(scope=initiative) 未执行——每 PR 独立过 CI+审查，跨 PR 集成审查缺位（流程债，非功能缺陷）
2. veto reason 未写入 status_reason（issue 35294752，P2）
3. GP7 出现有头/无头执行权竞争，由 Brain 无头容器最终交付；控制会话补两刀 CI 修复（清理顺序+allowlist 登记）
4. 首航验证待自然发生：晨报五段（明早 06:00）、direction-proposer（下周一 05:30）、第一条真实 GP 提案走完对抗
