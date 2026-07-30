# Red 证据 — 派发死循环三源根治（Issue cc28d1af）

- A `cecelia-run-symlink.test.sh`: FAIL — 软链调用下 launcher 路径 /var/folders/z2/scripts/claude-launch.sh 不存在（BASH_SOURCE 未解析）
- B `brain-deploy-drain-cancel.test.sh`: 0 pass / 2 fail — drain-cancel 仅存在于失败回滚路径，成功路径缺失
- C `dispatch-loop-caps.test.js`: 3 failed — transient requeue 无计数无上限；quarantine 自动释放无上限
