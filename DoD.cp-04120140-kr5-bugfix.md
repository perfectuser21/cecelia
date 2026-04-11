# DoD: Dashboard KR5 剩余 Bug 修复

## 验收标准

- [x] [ARTIFACT] `apps/dashboard/src/pages/brain-models/BrainModelsPage.tsx` 中 `handleSwitchProfile` 使用 `profile_id` (snake_case) 而非 `profileId`
  Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/brain-models/BrainModelsPage.tsx','utf8');if(!c.includes('profile_id: profileId'))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] Brain API `PUT /api/brain/model-profiles/active` 接受 `profile_id` 字段
  Test: `manual:curl -s -X PUT http://localhost:5221/api/brain/model-profiles/active -H 'Content-Type: application/json' -d '{"profile_id":"nonexistent"}' | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);if(!j.hasOwnProperty('success'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] `apps/api/src/vps-monitor/routes.ts` 包含 `/hk-stats` 路由
  Test: `manual:node -e "const c=require('fs').readFileSync('apps/api/src/vps-monitor/routes.ts','utf8');if(!c.includes('/hk-stats'))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] TypeScript 编译无错误
  Test: `manual:node -e "const {execSync}=require('child_process');try{execSync('npx tsc --project apps/dashboard/tsconfig.json --noEmit',{stdio:'pipe'});console.log('OK')}catch(e){console.error(e.stderr?.toString());process.exit(1)}"`
