# Contract: Preview Brain scheduler-jobs 幂等保护

**Task ID**: 5c32aace-4114-426c-b9dd-765f1c4d5bb2
**Gear**: hotfix (assembled by controller from anchor declarations)

---

## Test Contract

| Workstream | Test File | Behaviors | Priority | Description |
|---|---|---|---|---|
| ws1 | `packages/brain/src/__tests__/scheduler-jobs.test.js` | BRAIN_PREVIEW=1 时 startSchedulerJobsLoop 返回 null，不启动 setInterval / BRAIN_PREVIEW=1 时 startProjectionJobsLoop 返回 null，不启动 setInterval / BRAIN_PREVIEW 未设置时 startSchedulerJobsLoop 正常启动，前进 60s 触发 handler / BRAIN_PREVIEW=1 时 startSchedulerJobsLoop 打印含 BRAIN_PREVIEW 的日志 | P0 | B-1~B-4 Preview Brain 隔离守卫 |

## 铁律

- [IRON-1] generator 发现需改 Golden Path 断言 → FATAL，禁止顺手改，升档全流程
- [IRON-2] 修改范围限 `packages/brain/src/scheduler-jobs.js`；不改 `server.js` 调用侧

## E2E 验收

```bash
# 验证：Preview Brain 启动时 scheduler-jobs loop 不启动
# （单测覆盖已足够；Integration 路径依赖真实 BRAIN_PREVIEW env，同样由 BRAIN_PREVIEW 守卫拦截）
cd packages/brain && node -e "
  process.env.BRAIN_PREVIEW = '1';
  import('./src/scheduler-jobs.js').then(m => {
    const fakePool = { query: () => Promise.resolve({ rows: [] }) };
    const t1 = m.startSchedulerJobsLoop(fakePool);
    const t2 = m.startProjectionJobsLoop(fakePool);
    if (t1 !== null || t2 !== null) { console.error('FAIL: loop started in preview mode'); process.exit(1); }
    console.log('PASS: both loops returned null in BRAIN_PREVIEW=1 mode');
    process.exit(0);
  });
"
```

## 未覆盖真实链路清单

N/A — 修复点在模块导出函数入口，单测完整覆盖；Preview Brain 集成验证需真实 Docker 环境，超出 hotfix scope。
