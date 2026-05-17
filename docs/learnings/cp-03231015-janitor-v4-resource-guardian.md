# Learning: Janitor v4.0 — claude 孤儿进程判定

## 根本原因

Janitor 从未运行（crontab 路径错误），且只管 vitest/jest 而不管 claude 孤儿进程，导致 ppid=1 的孤儿 claude 持续占用 slot，让调度器 dispatchAllowed=false。

## 下次预防

- [ ] crontab 路径改变后立即验证软链接存在（`ls -la ~/bin/janitor.sh`）
- [ ] claude 孤儿判定必须双重验证（Brain DB + .dev-lock），任一存在则保守不杀
- [ ] 有头进程（TTY≠??）绝对不动，是第一道防线
- [ ] 白名单保护（brain/server.js、cecelia-bridge.cjs）写入代码而非注释
- [ ] packages/ 子目录开发时 PRD/DoD 必须同时放根目录和 packages/workflows/（branch-protect 就近检测）
