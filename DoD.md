# DoD: Dashboard KR5 KR 进度数据修复

## 验收标准

- [ ] [ARTIFACT] `packages/brain/src/routes/task-goals.js` 的 KR_SELECT 包含 `progress_pct` 字段
  Test: `manual:node -e "const c=require('fs').readFileSync('packages/brain/src/routes/task-goals.js','utf8');if(!c.includes('progress_pct'))process.exit(1);console.log('OK')"`

- [ ] [BEHAVIOR] `/api/brain/goals` 端点返回的 area_kr 条目含 `progress_pct` 字段
  Test: `manual:curl -s http://localhost:5221/api/brain/goals | node -e "const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));const kr=d.find(g=>g.type==='area_kr');if(!kr||kr.progress_pct===undefined)process.exit(1);console.log('OK progress_pct='+kr.progress_pct)"`

- [ ] [ARTIFACT] `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx` 使用 `progress_pct` 字段
  Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx','utf8');if(!c.includes('progress_pct'))process.exit(1);console.log('OK')"`

- [ ] [ARTIFACT] `apps/dashboard/src/pages/roadmap/RoadmapPage.tsx` 使用 `progress_pct` 字段
  Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/roadmap/RoadmapPage.tsx','utf8');if(!c.includes('progress_pct'))process.exit(1);console.log('OK')"`

- [ ] [BEHAVIOR] TypeScript 编译无错误
  Test: `manual:node -e "const {execSync}=require('child_process');try{execSync('node_modules/.bin/tsc --project apps/dashboard/tsconfig.json --noEmit',{stdio:'pipe'});console.log('OK')}catch(e){console.error(e.stderr?.toString());process.exit(1)}"`
