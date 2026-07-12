# DoD：launchd-patrol 哨兵

- [x] [BEHAVIOR] 必跑 daemon 被 disabled 时检出并告警 — Test: tests/ packages/brain/src/__tests__/launchd-patrol.test.js
- [x] [BEHAVIOR] daemon 未加载/未运行/端口不通分别检出 — Test: tests/ packages/brain/src/__tests__/launchd-patrol.test.js
- [x] [BEHAVIOR] 废弃名单 disabled 不告警、宿主不可达 fail-open — Test: tests/ packages/brain/src/__tests__/launchd-patrol.test.js
- [x] [BEHAVIOR] job 注册进 scheduler-jobs 且 needsPool:false — Test: tests/ packages/brain/src/__tests__/scheduler-jobs.test.js
- [x] CI 全绿
