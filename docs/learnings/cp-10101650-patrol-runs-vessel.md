## 代码运行记录正式注册（2026-10-10）

### 根本原因

task_runs已有统一推送引擎和字段合同，注册表停在pending_vessel。旧Ops Runs服务ops_runs，不能覆盖其归属来接代码执行。旧版本门禁回归仍断言手动bump提示，与现行changes碎片策略漂移。

### 下次预防

- [x] 登记入口拒绝目标库已有其它归属，先补列读回再提交，保留旧记录；由task-runs-config.test.js与真实PG smoke验证。
- [x] 创建可重试需来源标记和完整有界分页，异常分页不能当不存在；由task-runs-config.test.js验证。
- [x] 版本提示合同跟随changes/{VERSION}，禁止手改版本五件套；由version-gate-silent回归验证。
