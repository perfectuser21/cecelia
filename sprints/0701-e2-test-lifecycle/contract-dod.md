---
skeleton: false
journey_type: autonomous
---
# Contract DoD — Sprint: test 生命周期治理（E2）

**范围**: migration 311 additive + test-lifecycle-patrol.js（扫描判定 + 分级动作）+ tick-runner 集成
**大小**: M

## ARTIFACT 条目

- [ ] [ARTIFACT] `packages/brain/migrations/311_test_registry_lifecycle.sql` 存在且含 status / feature_id / orphan_reason / lifecycle_checked_at 四列定义
  Test: node -e "const c=require('fs').readFileSync('packages/brain/migrations/311_test_registry_lifecycle.sql','utf8');['status','feature_id','orphan_reason','lifecycle_checked_at'].forEach(col=>{if(!c.includes(col)){console.error('FAIL: 缺列',col);process.exit(1);}});console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/test-lifecycle-patrol.js` 存在且导出 `runTestLifecyclePatrol` 和 `isInLifecyclePatrolWindow`
  Test: node -e "const m=require('./packages/brain/src/test-lifecycle-patrol.js');if(typeof m.runTestLifecyclePatrol!=='function'||typeof m.isInLifecyclePatrolWindow!=='function'){console.error('FAIL: 导出缺失');process.exit(1);}console.log('OK')"

- [ ] [ARTIFACT] `packages/brain/src/tick-runner.js` 含 test-lifecycle-patrol import 和 fire-and-forget 调用
  Test: node -e "const c=require('fs').readFileSync('packages/brain/src/tick-runner.js','utf8');if(!c.includes('test-lifecycle-patrol')||!c.includes('runTestLifecyclePatrol')){console.error('FAIL: tick-runner 未集成');process.exit(1);}console.log('OK')"

## BEHAVIOR 条目（内嵌可执行 manual: 命令）

- [ ] [BEHAVIOR] migration 311 四列在 DB 中实际存在，存量行 status 默认 'active'
  Test: manual:bash -c '
  DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
  COL_COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM information_schema.columns WHERE table_name='"'"'test_registry'"'"' AND column_name IN ('"'"'status'"'"','"'"'feature_id'"'"','"'"'orphan_reason'"'"','"'"'lifecycle_checked_at'"'"')" | tr -d " ")
  [ "$COL_COUNT" = "4" ] || { echo "FAIL: 列数=$COL_COUNT"; exit 1; }
  NULL_COUNT=$(psql "$DB" -t -c "SELECT count(*) FROM test_registry WHERE status IS NULL" | tr -d " ")
  [ "$NULL_COUNT" = "0" ] || { echo "FAIL: status NULL_COUNT=$NULL_COUNT"; exit 1; }
  echo OK'
  期望: OK

- [ ] [BEHAVIOR] file_missing 场景：file_path 不存在 → patrol 后该行 status='orphan', orphan_reason='file_missing'（带时间窗口）
  Test: manual:bash -c '
  DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
  UPATH="/tmp/__dod_nonexist_$(date +%s).test.ts"
  rm -f "$UPATH"
  RID=$(psql "$DB" -t -c "INSERT INTO test_registry (file_path,test_count,covered_behaviors) VALUES ('"'"'$UPATH'"'"',0,'"'"'{}'"'"') ON CONFLICT (file_path) DO UPDATE SET status='"'"'active'"'"',orphan_reason=NULL RETURNING id" | tr -d " ")
  cd /workspace && node -e "const p=require('"'"'./packages/brain/src/test-lifecycle-patrol.js'"'"');p.runTestLifecyclePatrol({force:true}).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);})"
  S=$(psql "$DB" -t -c "SELECT status FROM test_registry WHERE id='"'"'$RID'"'"' AND lifecycle_checked_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " ")
  [ "$S" = "orphan" ] || { echo "FAIL: status=$S"; exit 1; }
  R=$(psql "$DB" -t -c "SELECT orphan_reason FROM test_registry WHERE id='"'"'$RID'"'"'" | tr -d " ")
  [ "$R" = "file_missing" ] || { echo "FAIL: reason=$R"; exit 1; }
  psql "$DB" -c "DELETE FROM test_registry WHERE id='"'"'$RID'"'"'" > /dev/null
  echo OK'
  期望: OK

- [ ] [BEHAVIOR] feature_deleted 场景：关联 deprecated feature 的行保留（不删），且 patrol 返回 featureDeletedList ≥ 1
  Test: manual:bash -c '
  DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
  REAL_FILE="/workspace/packages/brain/src/tick.js"
  FID=$(psql "$DB" -t -c "INSERT INTO journey_features (name,status,thickness) VALUES ('"'"'__dod_deprecated'"'"','"'"'deprecated'"'"','"'"'thin'"'"') RETURNING id" | tr -d " ")
  RID=$(psql "$DB" -t -c "INSERT INTO test_registry (file_path,test_count,covered_behaviors,feature_id) VALUES ('"'"'${REAL_FILE}__dod'"'"',0,'"'"'{}'"'"','"'"'$FID'"'"') ON CONFLICT (file_path) DO UPDATE SET feature_id='"'"'$FID'"'"',status='"'"'active'"'"' RETURNING id" | tr -d " ")
  cd /workspace && node -e "
    const p=require('"'"'./packages/brain/src/test-lifecycle-patrol.js'"'"');
    p.runTestLifecyclePatrol({force:true}).then(r=>{
      if(!r.featureDeletedList||r.featureDeletedList.length===0){console.error('"'"'FAIL: featureDeletedList empty'"'"');process.exit(1);}
      process.exit(0);
    }).catch(e=>{console.error(e);process.exit(1);});"
  CNT=$(psql "$DB" -t -c "SELECT count(*) FROM test_registry WHERE id='"'"'$RID'"'"'" | tr -d " ")
  [ "$CNT" = "1" ] || { echo "FAIL: 行被误删 count=$CNT"; exit 1; }
  psql "$DB" -c "DELETE FROM test_registry WHERE id='"'"'$RID'"'"'" > /dev/null
  psql "$DB" -c "DELETE FROM journey_features WHERE id='"'"'$FID'"'"'" > /dev/null
  echo OK'
  期望: OK

- [ ] [BEHAVIOR] feature_id IS NULL → 不出现在 featureDeletedList（防误标）
  Test: manual:bash -c '
  DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
  REAL_FILE="/workspace/packages/brain/src/tick.js"
  RID=$(psql "$DB" -t -c "INSERT INTO test_registry (file_path,test_count,covered_behaviors,feature_id) VALUES ('"'"'${REAL_FILE}__null_dod'"'"',0,'"'"'{}'"'"',NULL) ON CONFLICT (file_path) DO UPDATE SET feature_id=NULL,status='"'"'active'"'"' RETURNING id" | tr -d " ")
  cd /workspace && node -e "
    const p=require('"'"'./packages/brain/src/test-lifecycle-patrol.js'"'"');
    p.runTestLifecyclePatrol({force:true}).then(r=>{
      const bad=(r.featureDeletedList||[]).find(x=>x.id==='"'"'$RID'"'"');
      if(bad){console.error('"'"'FAIL: NULL feature_id 被误标'"'"');process.exit(1);}
      process.exit(0);
    }).catch(e=>{console.error(e);process.exit(1);});"
  psql "$DB" -c "DELETE FROM test_registry WHERE id='"'"'$RID'"'"'" > /dev/null
  echo OK'
  期望: OK

- [ ] [BEHAVIOR] 自愈场景：文件回来 → status='active', orphan_reason=NULL（带时间窗口）
  Test: manual:bash -c '
  DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
  TMPF=$(mktemp /tmp/dod_revive_XXXXXX.test.ts)
  RID=$(psql "$DB" -t -c "INSERT INTO test_registry (file_path,test_count,covered_behaviors,status,orphan_reason) VALUES ('"'"'$TMPF'"'"',0,'"'"'{}'"'"','"'"'orphan'"'"','"'"'file_missing'"'"') ON CONFLICT (file_path) DO UPDATE SET status='"'"'orphan'"'"',orphan_reason='"'"'file_missing'"'"' RETURNING id" | tr -d " ")
  cd /workspace && node -e "const p=require('"'"'./packages/brain/src/test-lifecycle-patrol.js'"'"');p.runTestLifecyclePatrol({force:true}).then(()=>process.exit(0)).catch(e=>{console.error(e);process.exit(1);})"
  S=$(psql "$DB" -t -c "SELECT status FROM test_registry WHERE id='"'"'$RID'"'"' AND lifecycle_checked_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " ")
  [ "$S" = "active" ] || { echo "FAIL: 自愈失败 status=$S"; exit 1; }
  OR=$(psql "$DB" -t -c "SELECT coalesce(orphan_reason,'"'"'NULL'"'"') FROM test_registry WHERE id='"'"'$RID'"'"'" | tr -d " ")
  [ "$OR" = "NULL" ] || { echo "FAIL: orphan_reason=$OR"; exit 1; }
  rm -f "$TMPF"
  psql "$DB" -c "DELETE FROM test_registry WHERE id='"'"'$RID'"'"'" > /dev/null
  echo OK'
  期望: OK

- [ ] [BEHAVIOR] journey_features DB 查询异常 → patrol 不抛出，返回含 skipped 标记
  Test: manual:bash -c '
  cd /workspace && node -e "
    const patrol = require('"'"'./packages/brain/src/test-lifecycle-patrol.js'"'"');
    if(typeof patrol.runTestLifecyclePatrol !== '"'"'function'"'"'){
      console.error('"'"'FAIL: runTestLifecyclePatrol 不是函数'"'"'); process.exit(1);
    }
    // 验证单测文件存在且含 db_error 场景（接缝在单测层覆盖）
    const fs=require('"'"'fs'"'"');
    const content=fs.readFileSync('"'"'sprints/0701-e2-test-lifecycle/tests/test-lifecycle-patrol.test.js'"'"','"'"'utf8'"'"');
    if(!content.includes('"'"'query failed'"'"') && !content.includes('"'"'db_error'"'"') && !content.includes('"'"'dbError'"'"')){
      console.error('"'"'FAIL: 单测缺 DB 错误场景'"'"'); process.exit(1);
    }
    console.log('"'"'OK'"'"');
  "'
  期望: OK

- [ ] [BEHAVIOR] file_missing + feature_deleted 同时成立 → file_missing 优先（status='orphan', orphan_reason='file_missing'，不进 featureDeletedList）
  Test: manual:bash -c '
  DB="${DATABASE_URL:-postgresql://localhost/cecelia}"
  NONEXIST="/tmp/__dod_prio_$(date +%s)_noexist.test.ts"
  rm -f "$NONEXIST"
  FID=$(psql "$DB" -t -c "INSERT INTO journey_features (name,status,thickness) VALUES ('"'"'__dod_prio_dep'"'"','"'"'deprecated'"'"','"'"'thin'"'"') RETURNING id" | tr -d " ")
  RID=$(psql "$DB" -t -c "INSERT INTO test_registry (file_path,test_count,covered_behaviors,feature_id) VALUES ('"'"'$NONEXIST'"'"',0,'"'"'{}'"'"','"'"'$FID'"'"') ON CONFLICT (file_path) DO UPDATE SET status='"'"'active'"'"',orphan_reason=NULL,feature_id='"'"'$FID'"'"' RETURNING id" | tr -d " ")
  cd /workspace && node -e "
    const p=require('"'"'./packages/brain/src/test-lifecycle-patrol.js'"'"');
    p.runTestLifecyclePatrol({force:true}).then(r=>{
      const bad=(r.featureDeletedList||[]).some(x=>x.id==='"'"'$RID'"'"');
      if(bad){console.error('"'"'FAIL: 行被错入 featureDeletedList'"'"');process.exit(1);}
      process.exit(0);
    }).catch(e=>{console.error(e);process.exit(1);});"
  S=$(psql "$DB" -t -c "SELECT status FROM test_registry WHERE id='"'"'$RID'"'"' AND lifecycle_checked_at > NOW() - interval '"'"'5 minutes'"'"'" | tr -d " ")
  [ "$S" = "orphan" ] || { echo "FAIL: status=$S"; exit 1; }
  R=$(psql "$DB" -t -c "SELECT orphan_reason FROM test_registry WHERE id='"'"'$RID'"'"'" | tr -d " ")
  [ "$R" = "file_missing" ] || { echo "FAIL: orphan_reason=$R"; exit 1; }
  psql "$DB" -c "DELETE FROM test_registry WHERE id='"'"'$RID'"'"'" > /dev/null
  psql "$DB" -c "DELETE FROM journey_features WHERE id='"'"'$FID'"'"'" > /dev/null
  echo OK'
  期望: OK

- [ ] [BEHAVIOR] tick-runner.js 集成：含 test-lifecycle-patrol import + runTestLifecyclePatrol fire-and-forget 调用
  Test: manual:bash -c '
  grep -q "test-lifecycle-patrol" /workspace/packages/brain/src/tick-runner.js || { echo "FAIL: 未 import"; exit 1; }
  grep -q "runTestLifecyclePatrol" /workspace/packages/brain/src/tick-runner.js || { echo "FAIL: 未调用"; exit 1; }
  echo OK'
  期望: OK
