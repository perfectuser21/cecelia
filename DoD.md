# DoD: CI 硬化第二批 — BEHAVIOR 动态命令真执行

- [x] [ARTIFACT] ci.yml 新增 dod-behavior-dynamic job
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/dod-behavior-dynamic:/.test(c))process.exit(1);if(!/services:[\\s\\S]{0,200}postgres:/.test(c.split('dod-behavior-dynamic:')[1]||''))process.exit(2);console.log('PASS')"

- [x] [ARTIFACT] dod-behavior-dynamic 里 Brain 启动 + /api/brain/health 等待逻辑存在
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const seg=c.split('dod-behavior-dynamic:')[1]||'';if(!/node src\\/server\\.js/.test(seg))process.exit(1);if(!/curl -sf http:\\/\\/localhost:5221\\/api\\/brain\\/health/.test(seg))process.exit(2);console.log('PASS')"

- [x] [ARTIFACT] TASK_CARD 扫描已加入 DoD.md（主）
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const m=c.match(/for f in [^;]*DoD\\.md/g);if(!m||m.length<2)process.exit(1);console.log('PASS found',m.length,'occurrences')"

- [x] [ARTIFACT] dod-behavior-dynamic 纳入 ci-passed needs
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');const m=c.match(/needs:\\s*\\[[^\\]]*\\]/g)||[];if(!m.some(x=>x.includes('dod-behavior-dynamic')))process.exit(1);console.log('PASS')"

- [x] [ARTIFACT] dod-behavior-dynamic 在 ci-passed check 列表出现
  Test: manual:node -e "const c=require('fs').readFileSync('.github/workflows/ci.yml','utf8');if(!/check\\s+\"dod-behavior-dynamic\"/.test(c))process.exit(1);console.log('PASS')"

- [x] [BEHAVIOR] 动态 curl 命令：Brain /api/brain/health 在 CI 起来的 Brain 上可达（dogfood — 验证本 PR 的新 job 真能跑通）
  Test: manual:curl -sf http://localhost:5221/api/brain/health

- [x] [BEHAVIOR] 动态 bash 命令：psql 能连上 postgres service 查 schema_migrations 表（dogfood）
  Test: manual:bash -c "PGPASSWORD=cecelia_test psql -h localhost -U cecelia -d cecelia_test -tAc 'SELECT COUNT(*) FROM schema_migrations' | grep -q '^[0-9]'"
