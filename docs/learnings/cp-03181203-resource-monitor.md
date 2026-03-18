## Learning - resource-monitor.js 新模块开发

### 根本原因
派发层缺乏 OS 物理资源感知，导致在系统高负载时无法自动限流。

### 实现方案
- 用 `os.loadavg()[0]` 获取 1 分钟 CPU 负载均值
- 用 `process.memoryUsage().heapUsed / heapTotal` 计算内存占比
- 阈值：CPU > 2.0 触发节流，内存占比 > 0.85 触发节流

### 下次预防

- [ ] 新模块需先创建 per-branch `.prd-<branch>.md` 和更新 `.dod.md`，否则 branch-protect hook 会阻止写文件
- [ ] vi.mock('os') 必须在 import 语句前声明，vitest 的 hoisting 机制才能正确工作
- [ ] resetThresholds() 函数用模块级变量实现，测试间需在 beforeEach 中重置，避免状态泄漏
