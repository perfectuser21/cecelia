# DoD: OKR 业务代码迁移 PR8 — 17个 HARD 文件 SELECT 迁移

- [ ] [BEHAVIOR] 迁移后核心文件引用新 OKR 表（okr_projects/key_results/objectives）而非旧表 type 查询
  Test: manual:node -e "const c=require('fs').readFileSync('packages/brain/src/kr-completion.js','utf8');if(!c.includes('FROM objectives'))process.exit(1);if(!c.includes('FROM okr_projects'))process.exit(1);console.log('ok: okr tables referenced')"

- [ ] [ARTIFACT] initiative-closer.js 迁移（13处）：type='initiative'→okr_initiatives, type='scope'→okr_scopes, type='project'→okr_projects
  Test: manual:node --check packages/brain/src/initiative-closer.js

- [ ] [ARTIFACT] focus.js 迁移（6处）：type='area_okr'→objectives, goals→key_results
  Test: manual:node --check packages/brain/src/focus.js

- [ ] [ARTIFACT] kr-completion.js 迁移（4处）：goals type='area_okr'→objectives, projects type='project'→okr_projects
  Test: manual:node --check packages/brain/src/kr-completion.js

- [ ] [ARTIFACT] kr-progress.js 迁移（3处）：projects type='initiative'→okr_initiatives, goals→key_results
  Test: manual:node --check packages/brain/src/kr-progress.js

- [ ] [ARTIFACT] review-gate.js 迁移（4处）：type='initiative'→okr_scopes(project_id)
  Test: manual:node --check packages/brain/src/review-gate.js

- [ ] [ARTIFACT] cortex.js 迁移（2处）：goals→key_results
  Test: manual:node --check packages/brain/src/cortex.js

- [ ] [ARTIFACT] distilled-docs.js 迁移（2处）：goals→key_results, projects→okr_projects
  Test: manual:node --check packages/brain/src/distilled-docs.js

- [ ] [ARTIFACT] entity-linker.js 迁移（2处）：goals→key_results, projects→okr_projects
  Test: manual:node --check packages/brain/src/entity-linker.js

- [ ] [ARTIFACT] notebook-feeder.js 迁移（2处）：goals→key_results, projects→okr_initiatives
  Test: manual:node --check packages/brain/src/notebook-feeder.js

- [ ] [ARTIFACT] memory-retriever.js 迁移（7处）：goals→key_results/objectives, projects→okr_initiatives/okr_projects
  Test: manual:node --check packages/brain/src/memory-retriever.js

- [ ] [ARTIFACT] nightly-tick.js 迁移（可迁查询完成，repo_path/lead_agent 保留旧表）
  Test: manual:node --check packages/brain/src/nightly-tick.js

- [ ] [ARTIFACT] notion-full-sync.js（notion_id 相关保留旧表，全量已注释说明）
  Test: manual:node --check packages/brain/src/notion-full-sync.js

- [ ] [ARTIFACT] routes/tasks.js 迁移（6处）：okr_projects→key_results→objectives→visions 上下文链路
  Test: manual:node --check packages/brain/src/routes/tasks.js

- [ ] [PRESERVE] 现有 Brain 测试不回归
  Test: manual:npm test --workspace=packages/brain
