# ZenithJoy Android Agent

安卓 Agent 客户端骨架，对齐 `services/agent`（Windows 端）的注册 + 双通道协议。

## 功能范围

- **机器指纹**：`Android ID + Build.MODEL → SHA-256（前32位十六进制）`，与 Windows 端 `computeMachineId()` 格式一致
- **注册**：`POST /api/agent/register`，请求体 `{ license_key, machine_id, hostname, agent_id, version }`，响应写入 SharedPreferences
- **WS 客户端**：连接 `wss://...?token=<licenseKey>`，open 发 `hello`，每 15s WS 心跳，断线指数退避重连
- **HTTP 心跳**：`POST /api/agent/heartbeat` 每 30s，上报 `{ license, version, hostname, os_type:"android", agent_uuid, machine_id }`，轮询 `queued_tasks`

不含无障碍服务采集逻辑（下一个 task）。

## 目录结构

```
app/src/main/java/com/zenithjoy/agent/
├── fingerprint/
│   └── MachineFingerprint.kt        # Android ID + 型号 SHA-256
├── config/
│   └── AgentConfig.kt               # 配置模型 + SharedPreferences 读写
├── network/
│   ├── RegisterService.kt           # POST /api/agent/register
│   ├── HeartbeatLoop.kt             # HTTP 心跳 + 任务分发
│   └── WsClient.kt                  # OkHttp WebSocket 客户端
├── service/
│   └── AgentService.kt              # 前台服务：启动注册 + 双通道
└── ui/
    └── SetupActivity.kt             # 首次配置 License Key
```

## 运行测试

```bash
# JVM 单元测试（不需要模拟器）
./gradlew :app:test
```

## 协议对齐说明

| 协议点 | Windows 端 | Android 端 |
|--------|------------|------------|
| 机器指纹算法 | `hostname \| platform \| mac → SHA256[0:32]` | `androidId \| model → SHA256[0:32]` |
| 注册端点 | `POST /api/agent/register` | 同 |
| WS URL | `wss://...?token=<licenseKey>` | 同 |
| hello payload | `{ agentId, agentUuid?, version, capabilities }` | 同（capabilities: `["android"]`）|
| WS 心跳 | 15s `{ type:"heartbeat", payload:{ uptime, busy } }` | 同 |
| HTTP 心跳 | 30s POST `/api/agent/heartbeat` | 同 |
