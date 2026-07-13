# DoD: T6 两轴衔接——KR metadata 轻边 + ability-progress 对账端点

- [x] [BEHAVIOR] PATCH /goals/:id 带 metadata 时用 COALESCE merge 写入（NULL 列不吞写）
  Test: tests/ packages/brain/src/__tests__/routes/task-goals.test.js
- [x] [BEHAVIOR] GET /okr/kr/:id/ability-progress 返回 abilities(thickness+advancement) 与 missing_ability_ids
  Test: tests/ packages/brain/src/__tests__/okr-ability-progress.test.js
- [x] [BEHAVIOR] metadata 无 target_abilities → 空 abilities + hint 且不发 join SQL
  Test: tests/ packages/brain/src/__tests__/okr-ability-progress.test.js
- [x] [BEHAVIOR] 格式非法的 ability id 不进 SQL 参数，直接归入 missing_ability_ids（防 500）
  Test: tests/ packages/brain/src/__tests__/okr-ability-progress.test.js
- [x] 版本四处同步（package.json/package-lock/.brain-versions/DEFINITION.md = 1.251.0）
  Test: manual: bash scripts/check-version-sync.sh
- [x] facts-check 通过
  Test: manual: node scripts/facts-check.mjs
