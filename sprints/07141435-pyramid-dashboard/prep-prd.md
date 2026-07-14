# 小改动 PrepPRD：Dashboard 测试金字塔页面（刀0 面板增量）

> Brain task ad00a93b；PRD 刀0节"面板进 Dashboard 一页"

## 改什么
1. apps/api：GET /api/quality/test-pyramid——宿主进程 execFile `node scripts/test-pyramid-guard.mjs --json`
   （api 跑在宿主，有主仓文件访问权；含 A4 本地模式）。5s 超时；guard 非零退出仍返回其 JSON（pass:false 是合法数据不是 500）
2. apps/dashboard：新页 /test-pyramid（照 relay-progress 页面惯例：pages/test-pyramid/ + __tests__）
   - 三层计数（unit/integration/e2e-smoke）+ 孤儿数 + smoke 未挂跑道数 + 守卫 PASS/FAIL + failures 列表 + 面板 generated 时间
   - 守卫红 = 页面醒目红条列 failures；数据不可用 = 灰态说明
3. 导航入口按现有 nav 惯例挂一项

## 验收标准
- [ ] api 端点单测（mock execFile 两态：pass/fail JSON）
- [ ] 页面组件测试（渲染三态：绿/红/不可用）
- [ ] 本机真跑：curl 端点返回真 guard JSON；页面 chrome 截图确认渲染
- [ ] CI 全绿
