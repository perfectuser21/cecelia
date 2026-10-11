## Brain {VERSION} — 技能工厂派发器：MMV 常驻把工厂任务派给 OpenClaw skill-factory 真机执行

- 新增 `packages/brain/scripts/factory-dispatcher/`（ESM 零依赖 + launchd LaunchAgent 模板 + README）：上海 09–23 时段闸、claim 409 跳过、代领设备锁（他人占锁只等不接管、等超时落 failed 不放锁）、UTF-8 消息文件读回校验、`openclaw agent --agent skill-factory` 启动与守望（ok:false / 超时 / 会话退出宽限期 → 杀会话、只放自己的锁、落 failed）、打回 queued 时 PATCH 回、终态不覆盖、自持锁周期 lock-refresh；linux/容器内拒绝运行（us-vps 零执行）
- 任务 f807bbb3；本期不做：崩溃恢复、按设备并发
