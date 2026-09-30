---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: 价值流建模③ workflows 表 + backbone_activities 改挂 + ops_workflows.workflow_id

**范围**: 新建 `workflows` 表 + `workflow_activities` 桥表；`journey_steps` 加 `workflow_id`/`executor_kind`/可空 `enabler_id`；`ops_workflows` 加可空 `workflow_id`；灌两 workflow 种子 + 8 活动改挂 + 7 活动共用桥接（决策 3e867cad 第 4-5 张表 + 752b7166）。
**大小**: M

> 断言前提：`$DB_URL` 由 Fleet 注入（local_api attempt 级空库）；B-01/B-07 自举跑 `node src/migrate.js`（幂等，可重复），其余断言假设迁移已应用。所有断言真 Postgres，无 mock。

## ARTIFACT 条目

- [ ] [ARTIFACT] 迁移 493 文件存在且含幂等守卫（IF NOT EXISTS / ON CONFLICT）与四张目标结构
  Test: node -e "const fs=require('fs'),d='packages/brain/migrations';const f=fs.readdirSync(d).find(x=>/^493_.*\.sql$/.test(x));if(!f){console.error('no 493 migration');process.exit(1)}const c=fs.readFileSync(d+'/'+f,'utf8');['CREATE TABLE IF NOT EXISTS workflows','workflow_activities','executor_kind','ON CONFLICT'].forEach(p=>{if(!c.includes(p)){console.error('missing:'+p);process.exit(1)}})"
  期望: exit 0

- [ ] [ARTIFACT] 冻结回归测试文件存在且断言桥表共用
  Test: node -e "const c=require('fs').readFileSync('sprints/09301633-kernel-29aa531a/tests/workflows-modeling.test.ts','utf8');if(!c.includes('workflow_activities')||!c.includes('pg')){process.exit(1)}"
  期望: exit 0

## BEHAVIOR 条目（五行剧本，内嵌 manual:bash 单行命令；autonomous / local_api / 真 Postgres）

- [ ] [BEHAVIOR] [L2] B-01: 跑迁移后 workflows 表存在含四列
  动作: 对 $DB_URL 跑 node src/migrate.js（自举，幂等），再查 information_schema
  预期观察: workflows 表含 capability_id/channel/version/status 四列（count=4）
  等待预算: 0s
  留证: psql count 输出 + grep exit code
  Test: manual:bash -c "(cd packages/brain && DATABASE_URL=\"\$DB_URL\" node src/migrate.js >/dev/null 2>&1); psql \"\$DB_URL\" -tAc \"SELECT count(*) FROM information_schema.columns WHERE table_name='workflows' AND column_name IN ('capability_id','channel','version','status')\" | grep -qx 4"

- [ ] [BEHAVIOR] [L2] B-02: journey_steps 新增三列
  动作: 查 information_schema 中 journey_steps 的 workflow_id/executor_kind/enabler_id
  预期观察: 三列齐（count=3）
  等待预算: 0s
  留证: psql count 输出
  Test: manual:bash -c "psql \"\$DB_URL\" -tAc \"SELECT count(*) FROM information_schema.columns WHERE table_name='journey_steps' AND column_name IN ('workflow_id','executor_kind','enabler_id')\" | grep -qx 3"

- [ ] [BEHAVIOR] [L2] B-03: executor_kind 接受合法值、CHECK 拒绝非法值
  动作: 事务内对 keyword_acquisition 活动先写合法值 agent（应成功）再写 illegal_kind（应被拒），均回滚
  预期观察: 合法值写入成功、非法值被 CHECK 拒绝（psql 非 0 退出）
  等待预算: 0s
  留证: 两次 psql 退出码 + OK/FAIL 行
  Test: manual:bash -c "psql \"\$DB_URL\" -v ON_ERROR_STOP=1 -c \"BEGIN; UPDATE journey_steps SET executor_kind='agent' WHERE capability_key='keyword_acquisition'; ROLLBACK;\" >/dev/null 2>&1 || { echo 'FAIL: 合法值被拒或列缺失'; exit 1; }; if psql \"\$DB_URL\" -v ON_ERROR_STOP=1 -c \"BEGIN; UPDATE journey_steps SET executor_kind='illegal_kind' WHERE capability_key='keyword_acquisition'; ROLLBACK;\" >/dev/null 2>&1; then echo 'FAIL: 非法值未被拒'; exit 1; else echo OK; fi"

- [ ] [BEHAVIOR] [L2] B-04: 抖音·关键词获客 workflow 下挂 8 个 keyword_acquisition 活动
  动作: 按 channel=douyin 定位 wf1，统计 workflow_id 指向它且 executor_kind 合法的 keyword_acquisition 活动数
  预期观察: 恰好 8 个活动改挂到 wf1 且 executor_kind ∈ {code,agent,human}
  等待预算: 0s
  留证: WF1 id + count 输出
  Test: manual:bash -c "WF1=\$(psql \"\$DB_URL\" -tAc \"SELECT id FROM workflows WHERE channel='douyin' AND capability_id='keyword_acquisition'\"); [ -n \"\$WF1\" ] || { echo 'FAIL: 无 wf1'; exit 1; }; psql \"\$DB_URL\" -tAc \"SELECT count(*) FROM journey_steps WHERE capability_key='keyword_acquisition' AND workflow_id='\$WF1' AND executor_kind IN ('code','agent','human')\" | grep -qx 8"

- [ ] [BEHAVIOR] [L2] B-05: 对标获客 workflow 共用 7 个活动且无物理副本
  动作: 按 channel=douyin_benchmark 定位 wf2，统计桥表指向既有 keyword_acquisition 活动的链接数，并核对骨干活动物理行数
  预期观察: wf2 共用恰好 7 个既有活动；keyword_acquisition 最新骨干活动物理行仍为 8（零副本）
  等待预算: 0s
  留证: WF2 id + 两个 count 输出
  Test: manual:bash -c "WF2=\$(psql \"\$DB_URL\" -tAc \"SELECT id FROM workflows WHERE channel='douyin_benchmark'\"); [ -n \"\$WF2\" ] || { echo 'FAIL: 无 wf2'; exit 1; }; psql \"\$DB_URL\" -tAc \"SELECT count(*) FROM workflow_activities wa JOIN journey_steps js ON js.id=wa.activity_id WHERE wa.workflow_id='\$WF2' AND js.capability_key='keyword_acquisition'\" | grep -qx 7 || { echo 'FAIL: 共用非7'; exit 1; }; psql \"\$DB_URL\" -tAc \"SELECT count(*) FROM journey_steps WHERE capability_key='keyword_acquisition' AND backbone_version=(SELECT max(backbone_version) FROM journey_steps WHERE capability_key='keyword_acquisition')\" | grep -qx 8"

- [ ] [BEHAVIOR] [L2] B-06: ops_workflows 含可空 workflow_id 列
  动作: 查 information_schema 中 ops_workflows.workflow_id 的可空性
  预期观察: 列存在且 is_nullable=YES
  等待预算: 0s
  留证: psql is_nullable 输出
  Test: manual:bash -c "psql \"\$DB_URL\" -tAc \"SELECT is_nullable FROM information_schema.columns WHERE table_name='ops_workflows' AND column_name='workflow_id'\" | grep -qx YES"

- [ ] [BEHAVIOR] [L2] B-07: INV-1 [幂等CAS] 重跑迁移不重复灌种子
  动作: 再次跑 node src/migrate.js，统计 workflow 数与 wf2 桥链接数
  预期观察: workflow 仍为 2、wf2 桥链接仍为 7（无重复）
  等待预算: 0s
  留证: 两个 count 输出
  Test: manual:bash -c "(cd packages/brain && DATABASE_URL=\"\$DB_URL\" node src/migrate.js >/dev/null 2>&1); psql \"\$DB_URL\" -tAc \"SELECT count(*) FROM workflows WHERE capability_id='keyword_acquisition' AND channel IN ('douyin','douyin_benchmark')\" | grep -qx 2 || { echo 'FAIL: 重跑后 workflow 非2'; exit 1; }; WF2=\$(psql \"\$DB_URL\" -tAc \"SELECT id FROM workflows WHERE channel='douyin_benchmark'\"); psql \"\$DB_URL\" -tAc \"SELECT count(*) FROM workflow_activities WHERE workflow_id='\$WF2'\" | grep -qx 7"

- [ ] [BEHAVIOR] [L2] B-08: INV-3 [不破坏既有] journey_id 仍 NOT NULL 且唯一约束仍在
  动作: 查 journey_steps.journey_id 可空性与 uq_journey_steps_activity 索引存在性
  预期观察: journey_id is_nullable=NO；唯一索引 uq_journey_steps_activity 存在（count=1）
  等待预算: 0s
  留证: is_nullable 输出 + 索引 count
  Test: manual:bash -c "psql \"\$DB_URL\" -tAc \"SELECT is_nullable FROM information_schema.columns WHERE table_name='journey_steps' AND column_name='journey_id'\" | grep -qx NO || { echo 'FAIL: journey_id 变可空'; exit 1; }; psql \"\$DB_URL\" -tAc \"SELECT count(*) FROM pg_indexes WHERE tablename='journey_steps' AND indexname='uq_journey_steps_activity'\" | grep -qx 1"

- [ ] [BEHAVIOR] [L2] B-09: INV-2 [枚举单源] executor_kind 枚举仅一份 CHECK 定义
  动作: 查 pg_constraint 中 journey_steps 上定义含 executor_kind 的 CHECK 约束数
  预期观察: 恰好 1 条（无手抄同值副本）
  等待预算: 0s
  留证: 约束 count 输出
  Test: manual:bash -c "psql \"\$DB_URL\" -tAc \"SELECT count(*) FROM pg_constraint c JOIN pg_class t ON t.oid=c.conrelid WHERE t.relname='journey_steps' AND c.contype='c' AND pg_get_constraintdef(c.oid) LIKE '%executor_kind%'\" | grep -qx 1"

## 铁律映射（历史约束三源 — 铁律清单逐条）

- INV-1 [幂等CAS] → B-07（重跑不重复灌种子）
- INV-2 [枚举单源] → B-09（executor_kind 枚举仅一份 CHECK 定义）
- INV-3 [不破坏既有] → B-08（journey_id NOT NULL + (journey_id, activity_key) 唯一约束保持）
