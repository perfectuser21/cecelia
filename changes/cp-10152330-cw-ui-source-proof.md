## Brain {VERSION} — 固定工作区测试来源补证

- 固定 Git 重建仅在原 F3 ci.yml binding 核验后，证明 workspace-test→API Vitest→真实 TSX import/render 的消费路径。
- 严格核执行封套、npm 入口与真实组件出口；未知变化继续拒绝，保留历史快照、owner、关系与注册回归。
- 当前为有限已审封套：测试/config/setup 格式与注释变化也需重新审查；候选本地验证不追认旧正式失败。
- Brain 显式锁定 TypeScript 5.9.3，适用证明才加载可信解析器；单包旧图读者可继续导入，缺依赖或版本不符明确失败。
- 证明根 workspace 安装的真实 manifest/lock 输入，并单独证明 Brain 独立 lock 的 setup-node 缓存键消费；同步继承 guard 的实际路由行号，保留原负例。
