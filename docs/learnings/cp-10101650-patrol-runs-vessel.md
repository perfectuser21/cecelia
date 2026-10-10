## 代码运行记录正式注册（2026-10-10）

### 根本原因

task_runs已有统一推送引擎和字段合同，注册表停在pending_vessel。旧Ops Runs服务ops_runs，不能覆盖其归属来接代码执行。旧版本门禁回归仍断言手动bump提示，与现行changes碎片策略漂移。首轮只直接调用服务的PG测试没有覆盖正式HTTP路由；新增smoke没有登记required allowlist，中央棘轮按合同拒绝。

### 下次预防

- [x] 登记入口拒绝目标库已有其它归属，先补列读回再提交，保留旧记录；由task-runs-config.test.js与真实PG smoke验证。
- [x] 创建可重试需来源标记和完整有界分页，异常分页不能当不存在；由task-runs-config.test.js验证。
- [x] 版本提示合同跟随changes/{VERSION}，禁止手改版本五件套；由version-gate-silent回归验证。
- [x] 正式入口用真实HTTP→router→服务→隔离PG验收：缺鉴权与enabled=false零写入，成功后读回active/push；外部Notion只在网络边界使用夹具。真实PG smoke共4项通过。
- [x] 新smoke在提交前加入required allowlist并实际执行；不以denylist或宽松数据库条件绕过棘轮。
- [x] 发布/doc/unit/smoke证据经正式source关系挂真实被固定CI消费的owner；消费图漏识别永久回归池时修实际selector证明，不把版本门禁假挂手机入口。

### 验证与交付边界

针对性48项与完整QuickCheck 2247文件/23053测试通过；真实PG仅使用本机scratch或CI隔离test库。本PR新增内部鉴权configure/bootstrap，返回独立代码运行记录库与统一pushTaskRuns vessel，保持旧ops_runs库和映射。首次部署后由主任务验收者调用bootstrap并核实际Notion记录；脚本调度启用不由本接口暗中执行。
