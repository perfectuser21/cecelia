# PRD: fix(brain) — Bark 通知 + 熔断器阈值调整

## 目标
1. 添加 Bark iOS 推送，让 P0 告警直达 Alex 手机
2. 熔断器阈值 3→8，避免 AI 任务偶发失败就停止全部派发

## 成功标准
- BARK_TOKEN 配置后，notifyCircuitOpen 等事件同时推 Bark
- FAILURE_THRESHOLD = 8，需连续失败 8 次才触发熔断
