---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 价值流建模⑤（收窄版）probes 重挂点+消费方切换 / cells 扩级 / steps-enablers Notion 投影

**范围**: `packages/brain/migrations/`（493+：step_probes RENAME→probes + target_type/target_id、journey_step_links 扩级、notion_projection_map 登记 steps/enablers + step_probes 行改 probes）+ `packages/brain/src/`（step_probes→probes 消费方切换：routes/step-probes.js / notion-probe-projection.js / lib/business-probe-judge.js / ops-notion-schema.js）+ `packages/brain/scripts/`（steps/enablers 投影 wiring + notion-probe smoke 随动）。
**不在范围内**: `golden_path`/`golden_paths`/`golden_path_contract_versions` 三表退役（转 Brain task `3e60816d-81d9-439f-8820-a764c7f953f3`）、13 张表其余未落地表、Dashboard UI、探针实际归位业务算法。
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] 迁移用 RENAME 改造 step_probes→probes，up 段无 DROP TABLE step_probes（零丢失结构保证）
  Test: node -e "const fs=require('fs');const g=require('child_process').execSync('ls packages/brain/migrations/*.sql').toString().split('\n').filter(Boolean);const all=g.map(f=>fs.readFileSync(f,'utf8')).join('\n');if(!/ALTER TABLE (IF EXISTS )?step_probes RENAME TO probes/.test(all))process.exit(1);const up=g.filter(f=>!f.includes('rollback')).map(f=>fs.readFileSync(f,'utf8')).join('\n');if(/DROP TABLE (IF EXISTS )?step_probes/.test(up))process.exit(1)"

- [ ] [ARTIFACT] 新迁移（493+）含回滚脚本且登记 schema_version
  Test: node -e "const fs=require('fs');const g=require('child_process').execSync('ls packages/brain/migrations/*.sql').toString().split('\n').filter(Boolean);const all=g.map(f=>fs.readFileSync(f,'utf8')).join('\n');if(!/INSERT INTO schema_version[\s\S]*'49[3-9]'/.test(all))process.exit(1);const rb=require('child_process').execSync('ls packages/brain/migrations/rollback/*.sql').toString();if(!/49[3-9]/.test(rb))process.exit(1)"

- [ ] [ARTIFACT] notion-probe-projection.js 随 probes 改名（引用 probes/target_type，不再依赖 step_probes 表名）
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/notion-probe-projection.js','utf8');if(/\bstep_probes\b/.test(c))process.exit(1);if(!/target_type/.test(c))process.exit(1)"

## BEHAVIOR 条目（内嵌 manual:bash，evaluator 逐条真跑）

- [ ] [BEHAVIOR] [L2] B-01: probes 表就位（step_probes 消失 + target_type/target_id 列齐）
  动作: 对注入的 $DB_URL 跑仓库全量迁移后，psql 查 probes/step_probes 存在性与列
  预期观察: probes 存在、step_probes 为 NULL、information_schema 有 target_type+target_id 两列
  等待预算: 0s
  留证: psql 输出（to_regclass 布尔 + 列计数 2）
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT (to_regclass('"'"'probes'"'"') IS NOT NULL AND to_regclass('"'"'step_probes'"'"') IS NULL) AND (SELECT count(*)=2 FROM information_schema.columns WHERE table_name='"'"'probes'"'"' AND column_name IN ('"'"'target_type'"'"','"'"'target_id'"'"'))" | grep -qx t && echo OK'

- [ ] [BEHAVIOR] [L2] B-02: probes target_type 回填 activity 且 CHECK 拒非法（探针零丢失 INV-4）
  动作: 插入一行默认 target_type 探针 + 尝试插入 target_type='bogus' 一行
  预期观察: 默认行 target_type='activity'；bogus 行被 CHECK 拒绝（插入失败）
  等待预算: 0s
  留证: psql 输出（activity 命中 + bogus 插入非 0 退出）
  Test: manual:bash -c 'psql "$DB_URL" -c "INSERT INTO probes (probe_key,workflow,stage,spec,spec_hash,target_type,target_id) VALUES ('"'"'dod-b02'"'"','"'"'wf'"'"','"'"'st'"'"','"'"'{}'"'"'::jsonb,repeat('"'"'a'"'"',64),'"'"'activity'"'"',gen_random_uuid()) ON CONFLICT (probe_key) DO NOTHING"; psql "$DB_URL" -tAc "SELECT target_type FROM probes WHERE probe_key='"'"'dod-b02'"'"'" | grep -qx activity || exit 1; if psql "$DB_URL" -c "INSERT INTO probes (probe_key,workflow,stage,spec,spec_hash,target_type) VALUES ('"'"'dod-b02bad'"'"','"'"'wf'"'"','"'"'st'"'"','"'"'{}'"'"'::jsonb,repeat('"'"'b'"'"',64),'"'"'bogus'"'"')" 2>/dev/null; then echo "FAIL: CHECK 未拒非法"; exit 1; fi; echo OK'

- [ ] [BEHAVIOR] [L2] B-03: journey_step_links 扩 step/enabler 级（target_type/target_id 列 + CHECK）
  动作: psql 查 journey_step_links 列 + 查 target_type CHECK 约束存在
  预期观察: target_type+target_id 两列齐；target_type CHECK 约束存在
  等待预算: 0s
  留证: psql 输出（列计数 2 + CHECK 计数 ≥1）
  Test: manual:bash -c 'C=$(psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.columns WHERE table_name='"'"'journey_step_links'"'"' AND column_name IN ('"'"'target_type'"'"','"'"'target_id'"'"')" | tr -d " "); [ "$C" = "2" ] || { echo "FAIL: 缺列 got=$C"; exit 1; }; psql "$DB_URL" -tAc "SELECT count(*) FROM information_schema.check_constraints WHERE constraint_name LIKE '"'"'%journey_step_links%target_type%'"'"'" | grep -qE "^[1-9]" || { echo "FAIL: 缺 target_type CHECK"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-04: step_probes RENAME 后活跃 src 消费方零残留（error/负向 — RENAME 后不 500 的前置闸）
  动作: grep packages/brain/src（排除 __tests__/注释）step_probes 表 SQL 读写
  预期观察: 无任何 FROM/INTO/UPDATE/JOIN step_probes 或 step_probes. 列引用残留（消费方全部切到 probes）
  等待预算: 0s
  留证: grep 空输出（命中即 FAIL 并打印残留行）
  Test: manual:bash -c 'if grep -REn "(FROM|INTO|UPDATE|JOIN)[[:space:]]+step_probes\b|step_probes\." packages/brain/src --include=*.js | grep -v "__tests__" | grep -vE "^[^:]+:[0-9]+:[[:space:]]*(//|\*)"; then echo "FAIL: 仍有 step_probes 表 SQL 残留"; exit 1; fi; echo OK'

- [ ] [BEHAVIOR] [L2] B-05: steps/enablers Notion 投影 wiring（notion_projection_map 两 active 投影目标）
  动作: psql 查 notion_projection_map 中 steps/enablers 投影目标行
  预期观察: brain_table IN (steps,enablers) 且 status=active 且 direction IN (push,both) 的行 ≥ 2
  等待预算: 0s
  留证: psql 计数输出（≥2）
  Test: manual:bash -c 'N=$(psql "$DB_URL" -tAc "SELECT count(*) FROM notion_projection_map WHERE brain_table IN ('"'"'steps'"'"','"'"'enablers'"'"') AND status='"'"'active'"'"' AND direction IN ('"'"'push'"'"','"'"'both'"'"')" | tr -d " "); [ "$N" -ge 2 ] || { echo "FAIL: got=$N"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] [L2] B-06: schema_version 前进 + selfcheck 逻辑绿（迁移已登记 ≥493）
  动作: psql 查 schema_version 最大版本号
  预期观察: MAX(version) >= 493（新迁移已登记，selfcheck 的 DB>=expected 成立）
  等待预算: 0s
  留证: psql 布尔 t
  Test: manual:bash -c 'psql "$DB_URL" -tAc "SELECT (SELECT MAX(version::int) FROM schema_version WHERE version ~ '"'"'^[0-9]{1,4}$'"'"') >= 493" | grep -qx t && echo OK'

- [ ] [BEHAVIOR] INV-1 [L2] [枚举单份] target_type 枚举（activity|step|enabler）JS 侧单份定义，无手抄副本
  动作: grep packages/brain/src 中把 activity/step/enabler 三值作为 JS 数组/枚举字面量的定义处
  预期观察: 该三元组 JS 字面定义至多一处（SQL CHECK 里的字符串不计；测试排除）
  等待预算: 0s
  留证: grep 计数 ≤ 1
  Test: manual:bash -c 'CNT=$(grep -REn "[\[(][[:space:]]*['"'"'\"]activity['"'"'\"][[:space:]]*,[[:space:]]*['"'"'\"]step['"'"'\"][[:space:]]*,[[:space:]]*['"'"'\"]enabler['"'"'\"]" packages/brain/src --include=*.js | grep -v "__tests__" | wc -l | tr -d " "); [ "$CNT" -le 1 ] || { echo "FAIL: target_type 枚举多份 got=$CNT"; exit 1; }; echo OK'

- [ ] [BEHAVIOR] INV-4 [L2] [探针零丢失] step_probes RENAME 迁入 probes、up 迁移无 DROP（RENAME 天然保数据）
  动作: grep 迁移 RENAME + 断言 up 段无 DROP TABLE step_probes
  预期观察: 存在 RENAME step_probes→probes；up 迁移无 DROP TABLE step_probes（RENAME 天然保数据零丢失）
  等待预算: 0s
  留证: grep 命中 RENAME + DROP 检查空
  Test: manual:bash -c 'grep -REl "ALTER TABLE (IF EXISTS )?step_probes RENAME TO probes" packages/brain/migrations/*.sql >/dev/null || { echo "FAIL: 缺 RENAME"; exit 1; }; if grep -RE "DROP TABLE (IF EXISTS )?step_probes" packages/brain/migrations/*.sql | grep -v rollback; then echo "FAIL: up 含 DROP step_probes"; exit 1; fi; echo OK'

## DoD → Test 映射说明

- B-01/B-02/INV-4 ↔ 冻结测试 `it('RENAME step_probes 到 probes ...')` / `it('probes target_type CHECK activity step enabler ...')` + 真 PG `it('probes target_type 回填 activity ...')`
- B-03 ↔ `it('journey_step_links target_type target_id ...')`
- B-04 ↔ `it('活跃 src 无 step_probes 表 SQL 残留 ...')`
- B-05 ↔ `it('notion_projection_map 注册 steps enablers ...')`
- B-06 ↔ 冻结测试 `it('schema_version 493 ...')`
- INV-1 ↔ 冻结测试 `it('target_type 枚举 activity step enabler ...')`（结构断言迁移含单份 CHECK 定义）
