## Brain {VERSION} — coding workflow 公共 claude 调用与验收基础库

- claude 子进程公共逻辑抽到 lib/claude.mjs（进程组收割、超时/取消、env 剥离与 GH 凭据隔离、stdout/stderr 分开收集、stream-json 模式只按 claude 自身错误事件判鉴权），spec 改用之，行为不变。
- 新增 lib/guards.mjs（md 链 sha256、远端分支快照、历史/分支检查、提交改动清单、agent 配置识别、文件暂移与放回）、lib/evidence.mjs（04-evidence 解析与判定）、lib/transcript.mjs（stream-json 执行记录核对）。
- md 链校验改为数据驱动，支持 01–04 四文件链（step_mismatch、<file>_not_covered:<ID>），chain_check 从上下文取应存在的链文件；I-n 格式收敛为单一常量。
- intent/spec 产出 intent_sha256 / spec_sha256；spec 发现 01 被改判 chain_tampered（契约已声明）。五活动工作流对外行为不变。
