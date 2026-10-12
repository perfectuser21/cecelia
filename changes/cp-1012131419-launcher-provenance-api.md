## Brain {VERSION} — 启动器会话出处通过核心 Brain API 登记

- 新增 session-provenance POST/GET，写入既有真身表、重复 session 保留原出处，严格只接收来源元数据。
- claude-launch 不再依赖执行机本地 cecelia 库，改用 Brain API，2 秒超时或故障照常启动 Claude；未知来源与 dry-run 不写入。
- 回归覆盖真实 HTTP 与 PTY、重复来源、非法输入和断网放行。
- 出处写入必须通过服务认证；启动器仅读安全凭据缓存，header经stdin传递，缺凭据或认证失败仍继续启动。
