# Contract DoD — Workstream 2: Dashboard Harness Pipeline 面板

- [ ] [ARTIFACT] `apps/dashboard/src/pages/harness/` 目录存在且包含页面组件
  Test: node -e "require('fs').accessSync('apps/dashboard/src/pages/harness');console.log('OK')"
- [ ] [BEHAVIOR] Dashboard 配置中注册了 `/harness` 路由，页面组件可被 DynamicRouter 加载
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessListPage.tsx','utf8');if(!c.includes('harness_planner'))process.exit(1);console.log('OK')"
- [ ] [BEHAVIOR] 页面从 Brain API 获取 harness 任务并渲染列表（至少显示标题和状态）
  Test: node -e "const c=require('fs').readFileSync('apps/dashboard/src/pages/harness/HarnessListPage.tsx','utf8');if(!c.includes('task_type=harness'))process.exit(1);if(!c.includes('status'))process.exit(1);console.log('OK')"
