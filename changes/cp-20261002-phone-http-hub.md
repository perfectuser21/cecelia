## Brain {VERSION} — 手机固定只读 runner 与独立 HTTP hub 观测底座

- 手机 `adb_get_state` 固定查询既有 ADB socket，不执行外部 ADB、不启停 daemon；私有 fsync journal、一次 launch intent、取消墓碑、boot/PID/starttime 与自己的手机锁绑定终态，未知不重派或提前释放。
- 独立 phone-hub :3459 提供固定 Bearer/HMAC、nonce、限额与硬超时合同。受信 manifest 覆盖 HTTP 端点、固定 SSH 物理绑定与实际依赖 bytes；物理只读 probe 核对真实 boot、worker、build/config/action hash、OS 资源和旧锁，不返回 available。启动后文件变化拒绝继续签旧版本。
- 全部 journal mutation 纳入跨进程持久 revision；真实 marker 身份包含 boot、设备号、inode、纳秒时间戳与权限，贯穿整轮维护比较。旧锁或持有的 guard 计入物理 pending；物理未知时 pending=null，marker 换代或未知不能签静默。本地控制账只证明 hub-control。
- 本阶段未接 Brain controller、未部署、未开放 grant、未改旧 cron；缺固定配置、凭据或初始化 journal 时 503，执行接口保持 503。该退出证明限固定 socket 查询，不推广为通用业务进程树证明。
- Brain B1新增可信HTTP只读客户端及不可变phone_hub版本合同，绑定Hub实际OS boot/config/build和physical machine/worker/boot/config/build/action，Bearer/HMAC/fresh nonce/严格结构/总接收deadline/分块限额/拒绝重定向；仅持久版本导出端点，不取caller URL或环境替代，不调用Brain SSH执行工具。缺凭据拒绝，start/inspect/cancel本地零network。
- 能力回签独立保留physical config/build及采样时间，防Hub同名字段覆盖与发送时间刷新旧探针；capabilities核完整selected physical原始观测。maintenance仅认证Hub binding与hub_control_only原始结构，不宣称每target完整物理身份或全MMV静止；未知仍pending=null，不生成available或verifiedcapacity。509不激活grant、不补写旧507 lease；实际物理资源阈值和完整controller属于后续阶段。
