# DoD: Dashboard KR5 KR 进度数据修复

## 验收标准

- [x] [ARTIFACT] `packages/brain/src/routes/task-goals.js` 的 KR_SELECT 包含 `progress_pct` 字段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/task-goals.js','utf8');if(!c.includes('progress_pct'))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] `task-goals.js` KR_SELECT SQL 含 COALESCE(progress,...) AS progress_pct，OBJ_SELECT 含 NULL::integer AS progress_pct
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/task-goals.js','utf8');if(!c.includes('COALESCE')||!c.includes('NULL::integer AS progress_pct'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx` 使用 `progress_pct` 字段
  Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx','utf8');if(!c.includes('progress_pct'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] `apps/dashboard/src/pages/roadmap/RoadmapPage.tsx` 使用 `progress_pct` 字段
  Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/roadmap/RoadmapPage.tsx','utf8');if(!c.includes('progress_pct'))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] TypeScript 编译无错误（主仓库源码编译验证）
  Test: `manual:node -e "const {execSync}=require('child_process');try{execSync('node_modules/.bin/tsc --project apps/dashboard/tsconfig.json --noEmit',{stdio:'pipe',cwd:'/Users/administrator/perfect21/cecelia'});console.log('OK')}catch(e){console.error(e.stderr?.toString());process.exit(1)}"`
