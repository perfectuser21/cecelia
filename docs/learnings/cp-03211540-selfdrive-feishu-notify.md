# Learning: SelfDrive 飞书推送集成

## 背景
将 SelfDrive 的战略思考结果连接到飞书推送，让 Cecelia 主动汇报。

### 根本原因
SelfDrive 每 4 小时产生分析结果，但只写入 cecelia_events 表，用户无感知。proactive-mouth.js 已有完整的飞书推送能力，只需在 runSelfDrive() 末尾调用即可。

### 下次预防
- [ ] 新增 Brain 模块输出时，检查是否需要连接通知渠道
- [ ] 使用 dynamic import 避免循环依赖（self-drive.js 已 import callLLM，再 import proactive-mouth 需要用 dynamic import）

## 关键决策
1. 使用 dynamic import 引入 proactive-mouth 和 llm-caller，避免 ESM 循环依赖
2. 只在有实际 action 时推送（created.length > 0 || adjustments.length > 0），无 action 不打扰
3. importance 设为 0.7（高于普通消息但非紧急）
4. try-catch 包裹确保推送失败不影响主流程
