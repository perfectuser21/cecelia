# 修复 Commander 公开授权说明误判

任务：88049aa6-d4fd-4acd-8cb8-0cdf71481691；父任务0994ab2a-0033-4225-9168-485350c5fc39。
target_environment: local_api。journey_type: dev_pipeline。

原任务的正式控制器因 payload.user_authorization 纯说明键含 auth，被凭据扫描错误拒绝。用户已授权继续全部未完成与必要门禁修复，说明必须保留并正常解析；真实凭据、无界文本及非法形状仍拒绝。只修任务 profile 解析边，不改变全局扫描、路由、执行策略或 evaluator/Judge。

验收：真实 task.payload 形状在显式和默认 hybrid profile 均解析且零修改；secret 字段和说明携带秘密拒绝；永久回归进入现有 Brain CI。保留旧失败 run，正常 native/CI 合并部署后以旧 payload 的真实 profile 回读验证。
