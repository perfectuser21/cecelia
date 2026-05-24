# Sprint PRD — License 系统

## 产品目标

为 Cecelia 平台建设一套完整的 License 管理系统，让管理员可以创建、分配和管理许可证，客户可以查看自己的授权状态和使用情况，同时确保系统部署流程自动化、可重复。目标用户包括：平台管理员（负责 License 分配与管控）和企业客户（查看自己的授权与用量）。

## 功能清单

### 后端 API
- [ ] Feature 1: License 创建 — 管理员可以创建不同类型（试用/正式/企业）的 License，设置有效期和功能权限
- [ ] Feature 2: License 查询 — 支持按用户、状态、类型检索 License 列表
- [ ] Feature 3: License 激活/停用 — 管理员可以激活或停用某个 License
- [ ] Feature 4: License 使用量上报 — 客户端调用 API 上报使用数据，系统记录并聚合
- [ ] Feature 5: License 校验端点 — 外部系统可通过 API Key 校验 License 有效性

### Dashboard 客户面板
- [ ] Feature 6: 我的 License — 客户登录后可查看自己当前持有的所有 License 及其状态
- [ ] Feature 7: 授权详情 — 客户可查看单个 License 的到期日、功能权限列表、当前用量
- [ ] Feature 8: 用量趋势图 — 客户可看到最近 30 天的 API 调用/使用量走势图
- [ ] Feature 9: 到期提醒 — License 到期前 7 天在 Dashboard 显示醒目提示

### Admin 后台
- [ ] Feature 10: License 管理列表 — 管理员查看全部 License，支持筛选/搜索/排序
- [ ] Feature 11: 批量创建 License — 管理员可一次性批量生成多个 License 并绑定到客户账号
- [ ] Feature 12: 客户授权分配 — 管理员将 License 分配给指定客户（按邮箱/账号 ID）
- [ ] Feature 13: License 审计日志 — 管理员可查看每个 License 的激活/使用/变更历史
- [ ] Feature 14: 数据统计看板 — 管理员可查看全局 License 发放数量、活跃数、到期数汇总

### CI 部署
- [ ] Feature 15: 自动化测试门禁 — 每次 PR 合并前自动跑 License 模块的单元测试与集成测试
- [ ] Feature 16: 数据库迁移自动化 — 部署时自动执行 schema migration，无需人工介入
- [ ] Feature 17: 环境变量配置校验 — CI 流水线校验必要的 License 相关环境变量已配置
- [ ] Feature 18: 健康检查端点 — 部署后自动探测 License API `/health` 端点，失败则回滚

## 验收标准（用户视角）

### Feature 1 — License 创建
- 管理员填写类型、有效期、权限范围后点击"创建"，系统生成唯一 License Key 并展示
- 创建成功后，License 立即出现在管理列表中，状态为"待激活"

### Feature 2 — License 查询
- 管理员在搜索框输入客户邮箱或 License Key，系统在 1 秒内返回匹配结果
- 支持按"状态（激活/停用/到期）"筛选，结果实时刷新

### Feature 3 — License 激活/停用
- 管理员点击"激活"后，License 状态立即变为"有效"，客户端校验接口随即可通过
- 点击"停用"后，客户端再次校验该 License 时收到"已停用"响应

### Feature 4 — License 使用量上报
- 外部系统每次调用后向 `/api/license/usage` 上报用量，系统累加并持久化
- 管理员和客户均可在各自面板看到最新用量数据（延迟不超过 5 分钟）

### Feature 5 — License 校验端点
- 外部系统携带 License Key 调用校验接口，有效时返回 `{valid: true, features: [...]}`
- 无效/过期/停用时返回对应错误码和说明

### Feature 6 — 我的 License（客户面板）
- 客户登录后首页展示自己名下的 License 卡片列表，每张卡片显示类型、状态、到期日

### Feature 7 — 授权详情
- 客户点击某个 License 卡片，进入详情页，看到功能权限列表和当月已用量/上限

### Feature 8 — 用量趋势图
- 详情页下方显示折线图，X 轴为日期，Y 轴为调用次数，可切换 7 天/30 天视图

### Feature 9 — 到期提醒
- 距到期 ≤ 7 天的 License 在客户面板顶部出现黄色横幅提示，点击可直接联系续费

### Feature 10 — License 管理列表（Admin）
- 管理员进入 Admin 后台 License 页，看到分页表格，每行显示 Key 前缀、所属客户、状态、到期日
- 支持按列排序（点击列头），按状态筛选

### Feature 11 — 批量创建
- 管理员填写数量（1-100）和参数模板，点击"批量生成"，系统输出可下载的 CSV 文件，含所有生成的 License Key

### Feature 12 — 客户授权分配
- 管理员在 License 详情页输入客户邮箱后点击"分配"，该客户登录后即可在面板看到此 License

### Feature 13 — 审计日志
- 管理员点击某 License 的"日志"按钮，看到时间线，记录每次状态变更、使用上报、分配操作及操作人

### Feature 14 — 数据统计看板
- Admin 首页展示 4 个数字卡片：总发放数、当前激活数、本月到期数、本月新增数

### Feature 15 — 自动化测试门禁
- PR 提交后 CI 自动运行，测试失败时 PR 无法合并，失败原因显示在 PR 评论中

### Feature 16 — 数据库迁移自动化
- 部署到任意环境时，migration 脚本自动执行，成功后应用启动，失败则部署终止并报警

### Feature 17 — 环境变量校验
- CI 运行时若缺少必要变量（如 `LICENSE_SECRET_KEY`），流水线在最早阶段失败并打印缺失变量名

### Feature 18 — 健康检查端点
- 部署完成 60 秒内，CI 探测 `/api/license/health`，返回 `{status: "ok"}` 视为部署成功，否则触发回滚通知

## AI 集成点（如适用）

- **License 异常检测**：对使用量骤增（超过历史均值 3 倍）的 License 自动标记，供管理员审查（防刷/滥用）
- **续费预测**：根据用量趋势预测客户是否可能需要升级套餐，Admin 看板给出提示

## 不在范围内

- 支付/计费系统（License 定价和收款由外部系统处理，本 sprint 不涉及）
- 多租户隔离架构改造（当前单租户架构不变）
- License 模板市场（预设模板管理为后续 sprint）
- 移动端 App 适配（本 sprint 仅 Web）
- 第三方 SSO 集成（使用现有登录体系）
