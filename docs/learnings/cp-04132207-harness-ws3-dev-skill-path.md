## Harness WS3 — /dev Skill 极简路径（2026-04-13）

### 根本原因

Harness Generator 运行 /dev 时，不需要 Learning 文件、fire-learnings-event、devloop-check 交互确认等人机交互步骤。原 04-ship.md 无 harness_mode 分支，Generator 被迫执行全套 Learning 流程导致浪费。devloop-check.sh 和 stop.sh 也缺少 harness 模式下的快捷通道和 Brain 失败回写机制。

### 下次预防

- [ ] 04-ship.md 修改时检查 harness_mode 双路径是否完整（skip 路径 + 正常路径）
- [ ] devloop-check.sh 新增 harness 失败路径时确认 curl PATCH 在 _harness_mode==true 守卫内 2000 字符内
- [ ] stop.sh 新增逻辑时确认非注释行包含 harness_mode/HARNESS_MODE 检测变量
