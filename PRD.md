# Brain CI 异常退出必须阻断合并

Task: d0f3e1cb-8e2f-4f0b-96da-5dd0917fdf50
GP-Anchor: none(infra)

官方9fa分片存在RPC/Unhandled错误和不完整完成回报，原run_vitest却仅凭passed摘要将非零改0。修复仅限该函数：Vitest原生passWithNoTests处理合法空集合，Vitest及tee任一非零均失败，函数不改变调用者shell选项；新增轻量永久回归必须成功才允许ci-passed。

不改变资源、分片、覆盖率阈值或生产Brain实现。当前语义归位F1开发闭环，回归文件位于真实F1的scripts/ci；ci.yml尚无地图路径owner的事实保留，不擅改地图。
