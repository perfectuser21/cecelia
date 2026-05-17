### 根本原因

watchdog 的 `sampleProcess` 和 `sampleProcessDarwin` 只采集单个 PID 的 RSS，而 harness task 实际上会派生 claude 子进程（RSS 主要在子进程中），导致 `task_run_metrics.peak_rss_mb` 始终显示 ~2MB 的极低值，无法反映真实内存消耗。

修复方案：
- Darwin: 改用 `ps -ax -o pid= -o ppid= -o rss= -o time=` 一次采集全部进程，BFS 遍历目标 PID 的所有后代进程，累加 RSS
- Linux: 扫描 `/proc` 构建 ppid 映射，BFS 找到所有子孙进程，累加每个进程的 `/proc/{p}/statm` RSS

### 下次预防

- [ ] watchdog 新增采样逻辑时，默认考虑父子进程树而非单进程
- [ ] vitest.config.js 的 exclude 列表定期清理：watchdog.test.js 是纯 mock 测试，无需排除
- [ ] Darwin ps 命令参数变更时同步更新测试中的 mock 字符串
