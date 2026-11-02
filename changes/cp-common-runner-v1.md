## Brain {VERSION} — 公共 Runner 与 Activity 十题证据闭环

- Brain 按执行目录授权与固定 profile 经 HTTP 派发公共 Workflow；现场复用现有 Activity runtime，支持 code 和固定 Skill adapter，禁止请求传入口、机器地址或凭据。
- 每次执行的 A1–A6/B1/C1–C3 分开保存定义引用、声明、实际观察、来源与 unknown；Step 五字段只记实际报告。探索按 Workflow DoD 验收，formal 校验逐次固定定义绑定、合同和独立验收，不自动升级样本或成熟度。
- Recorder 本地 fsync 事件及持久 outbox，中央写入后内容读回才 ACK；Brain 独立核对清单摘要和验收证据后补 run 终态。断网只补记录，重复启动不重做业务，重启及取消清场未知保留执行权。
- 第一版提供受保护 profile 的可选自动派发与收尾入口；未迁移业务和手动 Session Reporter 不被标记已迁移。执行代码及 profile.files 已列依赖验摘要；独立验收进程属于同一受信任宿主，非恶意代码隔离环境。
