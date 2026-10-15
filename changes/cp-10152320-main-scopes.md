## Brain {VERSION} — 主线双来源门禁与预览停止回执

- 官方 main 使用固定 KR 与 Factory bundle 联合验证完整差异，并实际执行各自登记的回归。
- 严格校验来源与独立 main_verification 用途；保留 PR、单来源及业务发布边界。
- PR 终态预览清理核实 stopped=true 业务回执；失败或未知结果保留持久待办，后续确认后才同步停止状态。
