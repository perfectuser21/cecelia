contract_source: hotfix task description / thin_prd

- [x] [BEHAVIOR] 全新隐私等价浏览器上下文覆盖五个 Workbench 深链，每页停留十秒并刷新，最终路径保持目标路径。
- [x] [BEHAVIOR] 旧 catch-all Service Worker 与 cache 升级时，即使 Web Storage 拒绝访问也注销旧 worker，避免其把深链导航回主页。
- [x] [BEHAVIOR] 回归测试以真实 Playwright Chromium、最终 URL 与 Service Worker registration 状态验收。
