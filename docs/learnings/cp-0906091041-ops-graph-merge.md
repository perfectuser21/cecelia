# Learning: 运行舱刀2——两库合并 + 编排关系可见

### 根本原因
- 刀1 的两个 Notion 库(Agents&机器 / 编排日历)是按**数据源**切的(ops_agents 表 / ops_schedule_entries 表),不是按主理人**看东西的方式**(一个"运行单元")切的——用户一眼看出该合一。
- "单 agent 独干 vs workflow 编排多 agent"的关系刀1 完全没采,但数据一直存在:OpenClaw clawdbot.json 每个 agent 的 `subagents.allowAgents` = 它编排的下级(图,dev 被 main+work-commander 双父)。

### 下次预防
- 投影库按**用户的观察单位**切,不按底层表切;定时/编排等是"运行单元"的属性,不该各拆一个库。
- 加维度优先查既有数据源有没有(allowAgents 白挖了才知道有),别急着新建采集。
- 免 migration 技巧:新增的结构化字段(orchestrates/delegation_mode)进现有 `meta jsonb` 白名单即可,不必改表——前提是不需要按它建索引/查询。
- 编排角色是**双向**判定:orchestrates 非空=orchestrator(领 workflow),被他人 allowAgents 含=member,都不=solo;父归属单列 orchestrated_by 数组(图,可多父)。单向只看 allowAgents 会漏"被编排"。
- 合并去重键:launchd 的 agent.name == schedule.label(都是 com.cecelia.*),按 (source,host,name==label) 合并,否则同一 job 显示两行。

### 交付
- extractOpenclawAgents meta 增采 orchestrates+delegation_mode(免 migration)
- /agent-ops/graph 合并投影端点(computeAgentRole + buildGraphPayload,agent+schedule 去重,role/workflow 现算,孤儿排程独立行)
- Notion 合并单库「Ops 运行图谱」(buildOpsUnitNotionProperties + pushOpsGraph,kv graph_db,旧两库停推数据保留)

- [ ] merge 后:brain-deploy 重建 + 跑 create-ops-notion-dbs.js 建新库 + 手删旧两库(Ops Agents&机器 / Ops 编排日历)
- [ ] 刀3:Dashboard 运行舱页消费 /agent-ops/graph
