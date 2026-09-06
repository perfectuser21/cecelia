# PrepPRD：运行舱刀2 — 两库合并为「Ops 运行图谱」+ 编排关系可见

- Brain task 574201ba ｜ 锚 工厂·指挥舱 G1 · S1 · 加厚 ｜ 决策 ac7a0911 ｜ 路径B（对刀1投影的重构+加维度）
- 前置：刀1 已上线（PR#5161，ops_agents/ops_schedule_entries/ops_source_heartbeats + /agent-ops 端点 + Notion 两库）

## 改什么（用户语言）
主理人反馈：现两个 Notion 库（Agents&机器 / 编排日历）按数据源切割不符直觉，要合成一个库——一行=一个"运行单元"，定不定时只是它的一个属性。同时要看到"单 agent 独干 vs 一个 workflow 编排多个 agent"的关系。

## 为什么改
① 两库按数据源切（agent表/schedule表）而非按主理人看的方式（运行单元）切；② 编排关系（谁编排谁）现在完全没采，看不到 workflow 结构。数据已确认存在：OpenClaw `clawdbot.json` 每个 agent 的 `subagents.allowAgents` = 它编排的下级 agent 清单（实测 10 编排者/14 单干，main 编排 14 个、dev 被 main+work-commander 双父编排=图）。

## 设计（对话已对齐 + 免 migration）
### D1 采集编排关系（meta jsonb 白名单，不改表）
`extractOpenclawAgents` 的 meta 增采 `orchestrates`（=subagents.allowAgents 数组）+ `delegation_mode`。白名单原则不变（仍禁 apiKey/auth 等凭据字段）。launchd/gha 无此字段，orchestrates=[]。

### D2 投影层现算 role/workflow + 合并（新端点 /agent-ops/graph）
`buildGraphPayload(pool, now)` 产"运行单元"行，合并 ops_agents + ops_schedule_entries：
- **role 现算**：orchestrates 非空 → `orchestrator`；被任一 agent 的 orchestrates 含 → `member`；否则 `solo`（先算全局 orchestrated_by map 再定）
- **workflow 归属**：member 行列出编排它的父（可多父=图，数组）
- **合并去重**：launchd job 的 ops_agents.name == ops_schedule_entries.label → 合成一行（agent 属性 + schedule 属性都有）；gha/brain_recurring 纯排程无对应 agent → 独立成行（role=solo，schedule 有值）
- **调度属性**：schedule_desc/next_run_utc 有值=定时；空=常驻/按需
- 契约续用刀1：per-source freshness、0条=source_status佐证、宁stale不假数据

### D3 Notion 合并为单库（废两库）
- `create-ops-notion-dbs.js` 改：建一个「Ops 运行图谱」库（属性 Name/Source/Machine/**Role**(select)/**Workflow**(rich_text 父编排者名,逗号分隔)/**Schedule**(rich_text,空=常驻)/**Repeat**(checkbox,定时类)/Status/LastSeen/NextRun/Suspicious）；kv `ops_notion_dbs` 改为 `{graph_db}`（旧 agents_db/calendar_db 停推，数据不动待主理人手删）
- notion-push：`pushOpsAgents` 改推 graph_db 且 buildProps 增 role/workflow/schedule（先拉全体算 orchestrated_by map）；`pushOpsSchedules` 改为只推**无对应 agent 的孤儿排程**(gha/brain_recurring)到同一 graph_db；两者 notion_id 各自回填各自底表

## 判定点登记（decisions e035dad8；均只读视图低危）
| 判定点 | 候选 | 所选 | 依据 | 误判后果 |
|---|---|---|---|---|
| 编排角色判定 | 只看allowAgents / 双向(编排+被编排) | 双向：orchestrates非空=orchestrator，被含=member，都不=solo | allowAgents是图(dev双父)，单向漏"被编排" | agent 角色标错(只读低危) |
| launchd agent与schedule合并键 | name / (source,host,name==label) | (source,host,name==label) | launchd的agent.name与schedule.label同值(com.cecelia.*) | 同一job显示两行(重复) |
| 空allowAgents+delegationMode≠none | 判编排者 / 判待定 | allowAgents空即非orchestrator(按实际下级) | prefer/suggest但空表=没实际下级 | 空编排者虚标(低危) |

## 影响范围
- 数据层：不改表（orchestrates 进现有 meta jsonb）
- 采集/端点/notion-push/create-dbs 四处改；旧两库停推不删数据
- 刀1 的 /agent-ops/agents|calendar 端点保留（Dashboard 刀3 可能仍用），新增 /agent-ops/graph

## 验收标准
- [ ] 采集后 psql 查 ops_agents.meta->'orchestrates'：openclaw 行有值（main 应含 14 个）
- [ ] GET /agent-ops/graph 返回运行单元行：含 role(orchestrator/member/solo)、workflow 父、schedule 属性；launchd job 不重复（一行）
- [ ] role 现算正确：main=orchestrator、dev=member(父=main,work-commander)、curator=solo
- [ ] Notion 单库「Ops 运行图谱」建成，行数=agent数+孤儿排程数，按 Workflow 分组可见编排结构
- [ ] 单测覆盖 computeRole/合并去重/孤儿排程；CI 全绿
