workstream_index: 1
sprint_dir: sprints/callback-queue-persistence

- [x] [ARTIFACT] migration 文件 `database/migrations/009-callback-queue.sql` 存在且格式正确
  Test: node -e "const c=require('fs').readFileSync('database/migrations/009-callback-queue.sql','utf8');if(!c.includes('CREATE TABLE callback_queue'))process.exit(1);console.log('OK')"
- [x] [BEHAVIOR] migration 执行后 callback_queue 表可用，列类型正确（task_id=uuid, result_json=jsonb, duration_ms=integer, created_at=timestamptz）
  Test: manual:psql cecelia -c "SELECT column_name, udt_name FROM information_schema.columns WHERE table_name='callback_queue' ORDER BY ordinal_position" | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8');const checks={task_id:'uuid',result_json:'jsonb',duration_ms:'int4',created_at:'timestamptz'};const errs=Object.entries(checks).filter(([c,t])=>{const l=s.split('\n').find(x=>x.includes(c));return!l||!l.includes(t)}).map(([c,t])=>c+' missing or wrong type');if(errs.length){console.error('FAIL:'+errs.join(','));process.exit(1)}console.log('PASS')"
- [x] [BEHAVIOR] 部分索引 idx_callback_queue_unprocessed 存在且条件为 processed_at IS NULL
  Test: manual:psql cecelia -c "SELECT indexdef FROM pg_indexes WHERE indexname='idx_callback_queue_unprocessed'" -t | node -e "const s=require('fs').readFileSync('/dev/stdin','utf8');if(!s.includes('processed_at IS NULL')){console.error('FAIL');process.exit(1)}console.log('PASS')"
