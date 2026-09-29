## Brain {VERSION} — Skill 台账投影 PR1a：三平台 skill 扫描入账 + A6 改比名单

- 迁移 491：skill_registry 加机器列（已装平台/在不在/原件/副本/分配 agent/正文/tier 建议）、人管列（目标平台/转 OpenClaw 难度/业务线/负责人/分类/备注）、推送基线列；去 `openclaw/` 前缀（先固定派发命令）；投影注册表 Skill Registry 改入口面 both（列级分权，同 Tasks）。决策 19391396 / 4b1da4ca，任务 47def5bb，F5 指挥舱 f20ec1cb。
- 新 job skill-inventory-sync（2h）：经 ssh mmv 送自包含 node 采集程序，扫 ~/.claude/skills、OpenClaw 各 agent 实际加载、~/.agents/skills、zenithjoy-skills 仓库；探不到≠零个，来源不全/熔断不判缺席，缺席满 24h 才 gone，断链即 broken；人管列与 status 不碰。
- A6 skill 账本一致性改比名单：ops_skills 引用的 skill 必须在账且在用、派发绑定行不得下线/断链；扫描未成功降级。
- /api/brain/skills POST/PATCH 冲突改合并，不再冲掉 notion_id/status/推送指纹。
