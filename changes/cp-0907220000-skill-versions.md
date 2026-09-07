## Brain {VERSION} — 运行舱刀7：skill 版本历史 + DisCo 成熟度 + 消除双写

- migration 441 `ops_skill_versions`（一代一行、只追加永不覆盖、**真外键**级联到 ops_skills）+ ops_skills 加 generation/eval_score/eval_baseline/eval_raw/disco_stage/stage_reason/stage_confident/has_postcondition 八列。解决「skill_registry 只存最新版、上一代考多少分全丢」的硬伤。
- DisCo 三档判定（判据来自决策「Workflow 执行体形态定线」）：software3 / disco / code。固化三条必须同时满足——形状重复 + 变体已探明 + 有探针；不可逆写入永远 code；无 postcondition 绝不升档。机器只算能算的（频率/成功率/有无探针），`stage_confident=false` 时等人确认，不自己拍板。
- 成熟度归属定型：**挂 skill**（被蒸馏的主体，有版本演进）；`rollupAgentMaturity`/`rollupWorkflowMaturity` 取最弱环节算出 agent 与 workflow 的成熟度（木桶效应），workflow 额外点名瓶颈阶段——下一刀该固化谁一目了然。
- eval 分数接 `skill_registry.metadata.eval_score`（180 个 skill 中 14 个有真分数；`skill_evals` 表 19 条全是 e2e 测试垃圾，不采用）。
- **消除 agent↔skill 双写**：真相源定为 `ops_agents.meta.skills`（直接来自 clawdbot.json），`ops_skills.used_by` 降为每轮从同一份 cfg 现算的派生反向索引，不接受其他写入方。
