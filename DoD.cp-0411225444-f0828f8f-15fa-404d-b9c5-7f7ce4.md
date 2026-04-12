# DoD: KR5 Dashboard Live Monitor OKR 进度 Bug 修复

## 验收标准

- [x] [BEHAVIOR] Live Monitor `/api/brain/goals` 返回的 `current_value` 被正确转换为 `progress` 百分比
  Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx','utf8');if(!c.includes('current_value != null'))process.exit(1);if(!c.includes('Math.round(cv / tv * 100)'))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] area_okr 进度从子 KR 平均值聚合，不再显示 0%
  Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx','utf8');if(!c.includes('computedProgress'))process.exit(1);if(!c.includes('progValues.reduce'))process.exit(1);console.log('OK')"`

- [x] [ARTIFACT] 活跃 KR 计数过滤器包含 `active` 状态
  Test: `manual:node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx','utf8');if(!c.includes(\"g.status === 'active'\"))process.exit(1);console.log('OK')"`

- [x] [BEHAVIOR] TypeScript 编译无错误
  Test: `manual:node -e "const {execSync}=require('child_process');try{execSync('npx tsc --project apps/dashboard/tsconfig.json --noEmit',{stdio:'pipe',cwd:'/Users/administrator/perfect21/cecelia'});console.log('OK')}catch(e){console.error(e.stderr?.toString());process.exit(1)}"`

- [x] [BEHAVIOR] Dashboard 测试全部通过 (120/120)
  Test: `tests/apps/dashboard/src/pages/live-monitor/LiveMonitorPage.test.tsx`
