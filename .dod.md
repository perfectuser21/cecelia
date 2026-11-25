# 历史导入 CLI 清退验收

Task: a91420af-8042-4d73-9a41-be33f02d847d
GP-Anchor: none(infra)

- [ ] 四个已复核无调用的历史 CLI 均删除；引用核查未发现现行可执行调用，历史文档保留。
  Test: manual:node --input-type=module -e "import assert from 'node:assert/strict'; import {existsSync} from 'node:fs'; assert(['seed-zenithjoy-initiatives.mjs','seed-features.js','sync-features-to-notion.mjs','migrate-from-notion.mjs'].every(p => !existsSync('packages/brain/scripts/'+p)))"
- [ ] packages/brain/src 全部源码与开发基线字节相同，现役派发和 Notion 任务/项目同步未改。
  Test: manual:node --input-type=module -e "import {execFileSync} from 'node:child_process'; execFileSync('git',['diff','--exit-code','513854937559cd845b227c9d2a2a6c7a2b1fee43','--','packages/brain/src'],{stdio:'inherit'})"
- [ ] 当前 Scripts CI 全部通过，包含事实、版本、迁移编号、DoD 与基本 CI 源码回归；无真实 seed 或业务迁移执行。
  Test: manual:node scripts/ci/run-basic-check.mjs scripts
