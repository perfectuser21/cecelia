# 西安 M4 PF 修复合同

## 边界

显式 interface-v2 将原 user501 策略扩大为全用户公网 TCP/UDP 限制。lo0、RFC1918/100.64、Tail IPv6、本机物理接口的精确 DHCP 广播、官方控制/日志 TCP443、认证 DERP 端点、两批准美国 peer UDP tuple 例外对全用户生效。生产切换未获批准，本棒只交付离线实现和可审候选。

## 不变量

- PF 规则不包含 user、group 或 log(user)，每条 pass 无状态；业务 TCP flags any。
- 健康授权需 fresh Self、美国稳定 ID/DNS、在线 ExitNodeStatus、prefs ID、各地址族公网与 MagicDNS 路由及 ifconfig 精确 Self 地址；PF 源地址绑定 Self，不硬编码 utun 名称。
- DERP cache root600、有期限；peer bootstrap 独立认证精确 tuple、15 秒有上界，不生成 IP×port 笛卡尔积；缓存损坏按缺失处理。
- 每次失效撤业务授权；独立 KeepAlive 守卫两秒巡检，业务 generation 最多 15 秒，加载/发布租约/撤权共用短 PF 锁。
- 激活前有效全锚点审计，其他身份查询、未知 quick、非零 states 均拒绝；input 默认放行让无状态 bootstrap 收响应。
- 独立回滚需要真实 PID 握手；切换、回滚、确认共用事务锁，每次变更核 deadline。回滚先停 lease guard，恢复专用 anchor、脚本/plist/cache；不关闭 PF、不全局 flush。

## 接缝

| 接缝 | 验证 |
| --- | --- |
| Darwin PF 语法 | M4 /tmp 真实生成双栈规则，pfctl -vnf，不加载 |
| Tailscale 身份/路由 | 认证 CLI 状态、prefs 公共字段、双栈 route 和 ifconfig，拒绝陈旧及复用 |
| 状态与其他锚点 | 真实只读 preflight；nonzero states/unknown quick 永久拒绝测试 |
| 事务与进程 | 独立 PID 握手、跨截止安装器、文件恢复与过期 generation 回归 |

官方网络依据：https://tailscale.com/docs/reference/faq/firewall-ports 。实现缩窄公网传输到精确端点，不直接采用官方宽泛 *:443/*:3478 建议。
