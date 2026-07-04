# DoD 清单：Relay 进度条 Dashboard 页面

**Task ID**: d56d5ad9-0e03-4106-8b38-23507bb14dc6
**日期**: 2026-07-04

---

## [BEHAVIOR] 条目

### [BEHAVIOR] [BEHAVIOR-1] 路由可访问，页面组件存在

访问 `http://localhost:5174/relay-progress`，页面不返回 404，`RelayProgressPage.tsx` 组件已挂载。

**验收命令（manual:bash）**：
```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:5174/relay-progress
# 期望输出：200
```

**代码验证**：
```bash
test -f apps/dashboard/src/pages/harness-pipeline/RelayProgressPage.tsx && echo "EXISTS" || echo "MISSING"
grep -n "relay-progress" apps/dashboard/src/components/DynamicRouter.tsx | head -5
```

---

### [BEHAVIOR] [BEHAVIOR-2] 七段进度条 HTML 结构正确，视觉状态有区分

页面渲染进度条时，七段 phase（planning/gan/generate/evaluate/judge/merge/report）均作为独立 DOM 节点存在，且对已完成/当前进行中/未到达三种状态应用不同 CSS class。

**验收命令（manual:bash）**：
```bash
# 在页面 HTML 中搜索七个 phase 标签
curl -s http://localhost:5174/relay-progress | grep -iE "planning|generate|evaluate|judge|merge|report" | head -10
```

**Playwright 断言**：TC-2 通过（七段标签文字全部存在于 DOM）

---

### [BEHAVIOR] [BEHAVIOR-3] 每行显示 initiative_id 前 8 位短码 + 当前 phase badge

有活跃 relay 时，每行显示短码（`initiative_id.slice(0, 8)`）和 `current_phase` 文字标签。

**验收命令（manual:bash）**：
```bash
# Brain 有活跃 relay 时，curl API 取第一条 initiative_id 前 8 位
FIRST_ID=$(curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs?limit=1" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try{const r=JSON.parse(d);console.log((r.runs||[])[0]?.initiative_id?.slice(0,8)||'NO_DATA');}catch(e){console.log('PARSE_ERR');}
  });
")
echo "期望在页面看到短码: $FIRST_ID"
```

**Playwright 断言**：TC-3 通过（mock 短码 `abcd1234` 渲染可见）

---

### [BEHAVIOR] [BEHAVIOR-4] 无活跃 relay 时显示空态文案

当 API 返回 `{ "runs": [] }` 时，页面显示「暂无进行中的 relay」，`[data-testid="relay-empty-state"]` 元素可见。

**验收命令（manual:bash）**：
```bash
# 若当前 Brain 无活跃 relay，直接访问页面应看到空态
curl -s "http://localhost:5221/api/brain/orchestrator/relay-runs?limit=20" | node -e "
  let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
    try{const r=JSON.parse(d);console.log('runs count:',r.runs?.length??'unknown');}catch(e){console.log('PARSE_ERR');}
  });
"
```

**Playwright 断言**：TC-4 通过（mock 空数组 → 空态文案可见）

---

### [BEHAVIOR] [BEHAVIOR-5] 页面每 15 秒自动刷新一次 API

页面挂载后启动 `setInterval(15000)`，每 15 秒重新调用 `GET /api/brain/orchestrator/relay-runs`，组件卸载时 `clearInterval` 清理。

**验收命令（manual:bash）**：
```bash
# 检查源码：自动刷新逻辑存在
grep -n "setInterval\|clearInterval\|15000\|15_000" apps/dashboard/src/pages/harness-pipeline/RelayProgressPage.tsx
# 期望：至少看到 setInterval 和对应的 clearInterval
```

---

## 构建验收

```bash
# TypeScript 编译零错误
cd apps/dashboard && npm run build 2>&1 | tail -5
# 期望：无 error 输出，exit code 0
```

---

## Playwright E2E 验收（4 条全通）

```bash
# 在 workspace 根目录执行（mac_web 环境）
npx playwright test apps/dashboard/e2e/relay-progress.spec.ts --reporter=list
# 期望：4 passed, 0 failed
```

---

## CI 验收

- `workspace-ci.yml` 绿灯（GitHub Actions 通过）
- PR 包含：`RelayProgressPage.tsx` + `DynamicRouter.tsx` 修改 + `relay-progress.spec.ts`

---

## DoD 汇总

| 编号 | 验收条目 | 类型 | 状态 |
|-----|---------|------|------|
| [BEHAVIOR] 路由可访问 | 路由可访问，组件文件存在 | behavior | [ ] |
| [BEHAVIOR] 七段进度条 | 七段进度条 HTML 结构正确 | behavior | [ ] |
| [BEHAVIOR] 短码渲染 | 短码 + phase badge 渲染 | behavior | [ ] |
| [BEHAVIOR] 空态文案 | 空态文案显示 | behavior | [ ] |
| [BEHAVIOR] 自动刷新 | 15 秒自动刷新 | behavior | [ ] |
| BUILD | npm run build 零编译错误 | build | [ ] |
| E2E-TC1 | 进度条容器可见 | e2e | [ ] |
| E2E-TC2 | 七段标签全在 DOM | e2e | [ ] |
| E2E-TC3 | mock 短码渲染可见 | e2e | [ ] |
| E2E-TC4 | 空态文案可见 | e2e | [ ] |
| CI | workspace-ci.yml 绿灯 | ci | [ ] |
