# DoD 检查表 — 主理人指挥舱（Owner Cockpit）

**Task ID**: 80a5be84-059a-4d86-a55c-a1e38f84e043
**Sprint Dir**: sprints/07162300-owner-cockpit
**日期**: 2026-07-16

---

## [BEHAVIOR] 行为断言

[BEHAVIOR] FR-02: 访问 `http://localhost:5174/` 时，DOM 中存在 6 个 `data-testid` 匹配 `metric-card-*` 的元素，且每个元素的 innerText 非空、不等于字面量 "undefined" 或 "null"（可为 `--`）。

[BEHAVIOR] FR-03: 访问 `http://localhost:5174/` 时，DOM 中至少存在 1 个 `data-testid="battle-card"` 元素，对应 `status IN (in_progress, queued, blocked)` 的真实任务，且点击任务条目后 URL 变更为 `/harness-pipeline?task_id={id}`。

[BEHAVIOR] FR-09: `packages/brain/src/scheduler-jobs.js` 的 `JOBS` 数组中存在名称为 `morning-cockpit-bark` 的条目；其 handler 实现在北京时间 08:30 ± 5min 窗口首次触发时调用 `sendBark()`，同一天第二次触发时因 sentinel key `morning-cockpit-bark` 命中去重而跳过，不重复推送。

[BEHAVIOR] FR-07: 在 viewport 宽度为 375px（移动端）时，页面 `document.body.scrollWidth` 不超过 375，且 6 张指标卡以单列布局（`grid-cols-1`）渲染，无元素溢出视口右侧。

[BEHAVIOR] FR-10: 执行 Playwright E2E 脚本 `sprints/07162300-owner-cockpit/tests/owner-cockpit.e2e.ts` 后，截图文件 `owner-cockpit.png` 存在于执行目录，文件大小 > 10240 bytes，且 E2E 测试以 exit code 0 结束。

[BEHAVIOR] FR-01: 访问 `http://localhost:5174/`（根路由）直接渲染 `OwnerCockpitPage` 组件，页面标题区域或 DOM 中包含指挥舱特征元素（如 `data-testid="owner-cockpit"`），不发生重定向到其他路由。

---

## manual:bash 可执行验收命令

### J-01/J-02 六指标卡可见性验证
```
manual:bash: npx playwright test sprints/07162300-owner-cockpit/tests/owner-cockpit.e2e.ts --grep "metric-card" --reporter=line 2>&1
```

### J-03 作战板验证
```
manual:bash: npx playwright test sprints/07162300-owner-cockpit/tests/owner-cockpit.e2e.ts --grep "battle-card" --reporter=line 2>&1
```

### J-04 Bark job 注册检查（静态代码检查）
```
manual:bash: grep -n "morning-cockpit-bark" /workspace/packages/brain/src/scheduler-jobs.js && echo "PASS: job registered" || echo "FAIL: job not found"
```

### J-05 Bark handler 无硬编码 token（安全检查）
```
manual:bash: grep -rn "BARK_TOKEN\s*=\s*['\"]" /workspace/packages/brain/src/morning-cockpit-bark.js 2>/dev/null && echo "FAIL: hardcoded token found" || echo "PASS: no hardcoded token"
```

### J-06 移动端无水平滚动
```
manual:bash: npx playwright test sprints/07162300-owner-cockpit/tests/owner-cockpit.e2e.ts --grep "mobile.*scroll\|overflow" --reporter=line 2>&1
```

### J-07 截图文件验证
```
manual:bash: test -f owner-cockpit.png && wc -c owner-cockpit.png | awk '{if($1>10240) print "PASS: screenshot ok ("$1" bytes)"; else print "FAIL: screenshot too small ("$1" bytes)"}' || echo "FAIL: owner-cockpit.png not found"
```

### 全量 E2E 验收
```
manual:bash: npx playwright test sprints/07162300-owner-cockpit/tests/owner-cockpit.e2e.ts --reporter=line 2>&1; echo "Exit: $?"
```

### API 健康检查（前置条件）
```
manual:bash: curl -sf "http://localhost:5221/api/brain/harness/stats" | python3 -c "import json,sys; d=json.load(sys.stdin); print('PASS: completion_rate='+str(d.get('completion_rate','MISSING'))+' total_pipelines='+str(d.get('total_pipelines','MISSING')))" 2>&1
```

```
manual:bash: curl -sf "http://localhost:5221/api/brain/guard-drill/status" | python3 -c "import json,sys; d=json.load(sys.stdin); print('PASS: guards='+str(len(d.get('guards',[]))))" 2>&1
```

```
manual:bash: curl -sf "http://localhost:5221/api/brain/tasks?status=in_progress" | python3 -c "import json,sys; d=json.load(sys.stdin); tasks=d if isinstance(d,list) else d.get('tasks',[]); print('PASS: in_progress tasks='+str(len(tasks)))" 2>&1
```

---

## DoD 检查表

### 前置门禁
- [ ] Brain 服务（localhost:5221）可访问，`GET /api/brain/harness/stats` 返回 `completion_rate` 和 `total_pipelines` 字段
- [ ] Dashboard 服务（localhost:5174）可访问
- [ ] DB 中存在至少 1 条 `status=in_progress` 任务（作战板非空前提）

### 代码实现
- [ ] `apps/dashboard/src/pages/owner-cockpit/OwnerCockpitPage.tsx` 已创建
- [ ] 根路由 `/` 映射到 `OwnerCockpitPage`（通过 coreConfig navGroups 或 DynamicRouter 配置）
- [ ] 六指标卡组件含正确 `data-testid`（`metric-card-completion-rate` 等 6 个）
- [ ] 六指标卡数据并行 fetch（`Promise.all`），不串行等待
- [ ] 作战板组件含 `data-testid="battle-card"` 且点击跳转正确
- [ ] 晨报 Feed 折叠展开逻辑可用
- [ ] 演习状态条展示 `last_run_at` 和连续绿计数
- [ ] 导览区静态配置 16 个页面，2/4 列 grid 响应式
- [ ] 全页面 `overflow-x-hidden`，移动端无水平滚动
- [ ] 任意 API 失败时对应卡片展示 `--`，不 throw 整页

### Brain 后端
- [ ] `packages/brain/src/morning-cockpit-bark.js` 已创建，实现时窗 + 去重逻辑
- [ ] `packages/brain/src/scheduler-jobs.js` JOBS 数组中新增 `morning-cockpit-bark` 条目
- [ ] handler 中无硬编码 BARK_TOKEN（仅使用 `notifier.js` 的 `sendBark()`）

### 测试
- [ ] `sprints/07162300-owner-cockpit/tests/owner-cockpit.e2e.ts` 已创建
- [ ] E2E 脚本断言 6 张指标卡可见
- [ ] E2E 脚本断言至少 1 张 battle-card 可见
- [ ] E2E 脚本生成 `owner-cockpit.png` 截图
- [ ] E2E 在本机 `mac_web` 环境（localhost:5174）通过

### 部署
- [ ] PR 描述中写明 HK 公网访问 URL
- [ ] deploy-dev.js webhook 链路验证通过（或修通记录）
- [ ] 未使用 SSH 手动 build

### 分支与 CI
- [ ] 代码在 `cp-07170642-ws-80a5be84` 分支，通过 PR → main（不直推）
- [ ] CI 绿才 merge
