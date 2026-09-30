## Brain {VERSION} — Skill 台账投影 PR1b：skill_registry 新列推到 Notion（列级分权）

- 新 job skill-registry-projection（取代 notion-push-sync.pushSkillRegistry）：2min 自 gate + advisory lock，每轮最多 25 行；Notion Skill Registry 补建 13 列（已装平台/存在性/最后扫描/原件路径/分配Agent/评测分/不一致副本数 + 人管的目标平台/转OpenClaw难度/业务线/负责人/分类/备注），改掉「🔒只读镜子」库描述。任务 47def5bb，决策 19391396 / 9088e075（快路）。
- 列账按列 id 认列：人改列名照写、人删列永不补建、人改列类型跳过该列；机器列单向覆盖，人管列三方基线合并（人在 Notion 改过的不覆盖，判定点 24736022）。
- 建页前按标题查重认领（修 09-28 重复建页），普通 400 指数退避不再清 notion_id，404 才解绑重建；每日归档机器人建的孤儿页。
