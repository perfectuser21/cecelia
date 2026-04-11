# DoD: Dashboard KR5 阻断Bug清零 — VPS Monitor 路由修复

## 变更内容

- `packages/brain/src/routes/vps-monitor.js`: 新增 `GET /hk-stats` 端点（Tailscale 代理到 HK Brain）
- `apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx`: 三条 vps-monitor 调用从 `/api/v1/` 改为 `/api/brain/`
- `packages/brain/src/__tests__/routes/vps-monitor.test.js`: 新增 hk-stats 2 个行为测试

## DoD 验证清单

- [x] [ARTIFACT] `packages/brain/src/routes/vps-monitor.js` 包含 `GET /hk-stats` 路由
  Test: `node -e "const c=require('fs').readFileSync('packages/brain/src/routes/vps-monitor.js','utf8');if(!c.includes('/hk-stats'))process.exit(1);console.log('ok')"`

- [x] [ARTIFACT] `LiveMonitorPage.tsx` 不再调用 `/api/v1/vps-monitor/`
  Test: `node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/live-monitor/LiveMonitorPage.tsx','utf8');if(c.includes('/api/v1/vps-monitor'))process.exit(1);console.log('ok')"`

- [x] [BEHAVIOR] Brain `/api/brain/vps-monitor/stats` 返回 200
  Test: `manual:curl -s -o /dev/null -w "%{http_code}" localhost:5221/api/brain/vps-monitor/stats`

- [x] [BEHAVIOR] hk-stats 新增测试通过（可达返回 200，不可达返回 503）
  Test: `tests/packages/brain/src/__tests__/routes/vps-monitor.test.js`
