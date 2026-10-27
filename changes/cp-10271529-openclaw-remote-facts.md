## Brain {VERSION} — 飞书交办账本读取 Mac Studio 执行事实

- 复用现有 host-exec/SSH mmv 只读通道读取全部 runtime 的执行证据，停止读取 US 旧 OpenClaw SQLite。
- 远端读取失败记 unknown 与明确错误，不再等同空执行；正常空结果及原归类、去重、非执行任务约束保持。
