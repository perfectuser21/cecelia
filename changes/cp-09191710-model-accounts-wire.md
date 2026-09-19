## Brain {VERSION} — 刀2 收口：模型账号配额采集接入调度 + 真实三家 usage 探针

- PR #5411 上产后验收发现两处空转：`runModelAccountsCollector` 只导出未注册进 scheduler-jobs（`ops_model_accounts` 恒空、端点恒返 0 条）；`defaultFetchUsage` 把 `cat 凭据文件` 当 usage JSON，从未真正调过 usage 接口。
- 新增 `model-accounts-usage-probe.js`（自包含 ESM，base64 经 host-exec ssh 投到 mmv 用 node 从 stdin 执行）：在凭据所在宿主读当前 token/key，调 Anthropic oauth/usage、ChatGPT wham/usage、Grok GetGrokCreditsConfig（gRPC-web 解帧），**只回传归一化 usage JSON，凭据不离开宿主**；任何路径不碰 refresh 类字段，Grok grpc-status 7 以非零退出上抛 → key_expired。
- wham 实测形状归一（primary/secondary 窗按 limit_window_seconds 归 5h/7d，reset_at epoch → ISO）；scheduler 注册 `ops-model-accounts-collector`（5min 自 gate，timeout 120s）。
