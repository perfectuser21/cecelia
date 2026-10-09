# proven-to-fire 证据：2026-09-06 真实故障注入

方法：sudo tailscale logout 制造 NeedsLogin，不做任何手动干预，
等待 launchd 每 60 秒调度的 watchdog 自行恢复。

结果：41 秒内自动恢复至 Running，IP 未漂移（100.71.151.105 前后一致）。

## watchdog 日志
```
{"action": "ok", "component": "tailscale_login_watchdog", "reason": "running", "warnings": []}
{"action": "ok", "component": "tailscale_login_watchdog", "reason": "running", "warnings": []}
{"action": "reauth", "backend_state": "Running", "component": "tailscale_login_watchdog", "reason": "backend_state:NeedsLogin", "self_ips": ["100.71.151.105", "fd7a:115c:a1e0::b336:9769"], "warnings": []}
```

## 状态文件
```json
{"consecutive_failures": 0, "last_attempt_ts": 1788701662.8353522, "last_ip": "100.71.151.105"}
```

## 安全检查
日志与状态文件均无 tskey- 明文（redact() 生效）。
