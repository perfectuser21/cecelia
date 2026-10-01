# 西安 M4 PF 修复合同

## 边界

显式 interface-v2 将原 user501 策略扩大为全用户公网 TCP/UDP 限制。lo0、RFC1918/100.64、Tail IPv6、本机物理接口的精确 DHCP 广播、官方控制/日志 TCP443、认证 DERP 端点、两批准美国 peer UDP tuple 例外对全用户生效。生产切换未获批准，本棒只交付离线实现和可审候选。

## 不变量

- PF 规则不包含 user、group 或 log(user)，每条 pass 无状态；业务 TCP flags any。
- 健康授权需 fresh Self、美国稳定 ID/DNS、在线 ExitNodeStatus、prefs ID、各地址族公网与 MagicDNS 路由及 ifconfig 精确 Self 地址；PF 源地址绑定 Self，不硬编码 utun 名称。
- DERP cache root600、有期限；peer bootstrap 独立认证精确 tuple、15 秒有上界，不生成 IP×port 笛卡尔积；缓存损坏按缺失处理。
- 每次失效撤业务授权；独立 KeepAlive 守卫两秒巡检，业务 generation 最多 15 秒；封闭策略也随 peer/DERP 缓存到期主动刷新，成功加载摘要避免重复写 PF，加载/发布租约/撤权共用短 PF 锁。
  PF 自身没有 TTL；主动撤权受 PF 命令耗时及锁等待影响，同时停止主巡检和独立守卫不能保证规则自动过期。
- 激活前有效全锚点审计，其他身份查询、未知 quick、非零 states 均拒绝；input 默认放行让无状态 bootstrap 收响应。
- 默认确认仍需双目标手机真实 shell；仅激活时明确审批 network-recovery 可按激活前 root600/hash 绑定基线验收，基线在线手机不得退化，原离线设备记 phones_outstanding。网络确认不表示手机恢复或任务完成；confirm 不能改确认范围。
- 独立回滚需要真实 PID 握手；切换、回滚、确认共用事务锁，每次变更核 deadline。激活拒绝目标 gui/user 已加载旧代理，新 installer staging 只写 root 事务目录。回滚先停 lease guard，恢复专用 anchor、脚本/plist/cache；不关闭 PF、不全局 flush。

## 接缝

| 接缝 | 验证 |
| --- | --- |
| Darwin PF 语法 | M4 /tmp 真实生成双栈规则，pfctl -vnf，不加载 |
| Tailscale 身份/路由 | 认证 CLI 状态、prefs 公共字段、双栈 route 和 ifconfig，拒绝陈旧及复用 |
| 状态与其他锚点 | 真实只读 preflight；nonzero states/unknown quick 永久拒绝测试 |
| 事务与进程 | 独立 PID 握手、跨截止安装器、文件恢复与过期 generation 回归 |

官方网络依据：https://tailscale.com/docs/reference/faq/firewall-ports 。实现缩窄公网传输到精确端点，不直接采用官方宽泛 *:443/*:3478 建议。

## E2E 验收（target_environment: local_api）

在候选 checkout 执行同一永久回归：真实临时文件恢复、安装器跨事务截止、进程未退出时拒绝恢复、健康双栈与缓存封闭，以及目标 ADB 验收的命令和结果检查。在 macOS 另由实际 pfctl -vnf 解析生成规则；Linux 缺原生 PF 时仅跳过该解析用例，目标 M4 的实际解析需另附只读证据。此验收不加载生产 PF，也不操作手机。

```bash
set -euo pipefail
python3 tests/regression/tailscale-us-exit/pf-identity-free.test.py -v
bash -n scripts/ops/install-tailscale-us-exit-enforcer.sh
```

通过标准：42 条回归运行、进程 exit 0；PF 原生解析以目标机实际证据补齐。生产切换、真实美国出口/双 ADB 验收和取消回滚均属独立明确审批后的阶段。

## Test Contract

| Workstream | Test File | BEHAVIOR 覆盖 | 预期 Red 证据 |
|---|---|---|---|
| 根合同采集守卫 | `sprints/tests/root-contract.test.mjs` | `根合同登记通过且子Sprint孤儿仍被真实守卫拒绝` | 合入 main 的真实根/子合同采集守卫自测，不扩合同吸收子 Sprint 孤儿 |
| 原生执行入口 | `sprints/tests/pf-identity-free.test.mjs` | `native entry executes immutable PF deadlock regression suite` | 子进程运行唯一永久回归，退出异常、无完整结果或源码 digest 变化拒绝 |

原生入口冻结永久 Python 回归的 SHA-256 并实跑该文件，避免重复断言和合同外测试漂移。根因 failing-test 提交 b139eca8bd 永久保留在本 PR 历史，CI core-regression 运行同一 Python 文件。
