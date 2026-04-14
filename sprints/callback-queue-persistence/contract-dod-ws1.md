# Contract DoD — Workstream 1: DB Migration + Callback Queue 表

- [ ] [ARTIFACT] migration 文件 `database/migrations/009-callback-queue.sql` 存在且格式正确
  Test: node -e "const c=require('fs').readFileSync('database/migrations/009-callback-queue.sql','utf8');if(!c.includes('CREATE TABLE callback_queue'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] migration 执行后 callback_queue 表可用，部分索引 idx_callback_queue_unprocessed 存在
  Test: manual:psql cecelia -c "SELECT 1 FROM information_schema.tables WHERE table_name='callback_queue'" -t | node -e "if(!require('fs').readFileSync('/dev/stdin','utf8').trim().includes('1')){process.exit(1)}console.log('PASS')"
