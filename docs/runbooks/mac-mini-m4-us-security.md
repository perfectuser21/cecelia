# Runbook：mac-mini-m4-us 安全态势

> 公网托管 Mac mini 的访问方式、防火墙规则、加固记录。最后更新 2026-06-14。

## 机器身份

| 项 | 值 |
|---|---|
| 主机名 | `aad17-2.macminivault.com` |
| 公网 IP | `38.23.47.81`（macminivault 托管，本机访问该 IP 走 loopback `lo0`，不经 en0） |
| Tailscale IP | `100.71.151.105`（节点名 `mac-mini-m4-us`，MagicDNS `mac-mini-m4-us.tailce7a8b.ts.net`） |
| 公网网卡 | `en0` |
| 带外应急 | macminivault Customer Panel → KVM（独立于 OS，不依赖 SSH/VNC） |

## 怎么连进来

| 方式 | 怎么连 | 认证 |
|---|---|---|
| **SSH（终端）** | `ssh administrator@100.71.151.105`（Tailscale）或 `ssh administrator@38.23.47.81`（公网，应急） | **仅公钥**，公网密码登录已关 |
| **Tailscale SSH** | tailnet 内 `ssh administrator@mac-mini-m4-us`，靠 tailnet 身份 + ACL（member→self） | 身份，无需密钥 |
| **屏幕共享 / VNC** | 已**整体停用**（`com.apple.screensharing` bootout+disable）。需要 GUI 走 KVM 或重新开启后仅限 Tailscale | — |
| **1Password SSH agent** | 客户端开 `Use the SSH agent`，私钥存 1Password，登录按 Touch ID/PIN；公钥加到本机 `~/.ssh/authorized_keys` | 生物识别 |

## 防火墙（pf）

- Anchor 文件：`/etc/pf.anchors/cecelia-security`
- 主配置引用：`/etc/pf.conf`（`anchor "cecelia-security"` + `load anchor ... from ...` 两行，缺一不生效——历史 bug：曾用 `anchor "x" from "file"` 单行语法导致规则**从未加载**）
- 开机持久化：LaunchDaemon `/Library/LaunchDaemons/com.cecelia.pf-firewall.plist`（`pfctl -E -f /etc/pf.conf`）
- 规则形态：`block in on en0/en1 proto tcp to any port <P>` —— 只挡**公网入站**；Tailscale（utun）、本机 loopback 不受影响

### 已封死公网的端口（仅内部用）
`88`(kdc) `3001/5211`(OrbStack) `3457/5200/7789`(node) `18888`(Python) `5900`(VNC) **`5221`(Brain 控制台 API)**

### 保留公网的端口（有合法外部消费者）
| 端口 | 服务 | 为什么公开 |
|---|---|---|
| 22 | SSH | 仅密钥，应急入口 |
| 80/443/8080 | nginx / xray | 站点 / 代理 |
| 9998 | Python 静态服务 | 发布内容图片、登录二维码（浏览器/手机要外部可达） |
| 7786 | douyin-proxy | 桥接 **N8N Cloud（外部 SaaS）→ xian-m1**，N8N 不在 tailnet 只能走公网 |

### 改防火墙的标准动作
```bash
sudo vi /etc/pf.anchors/cecelia-security        # 改规则
sudo pfctl -vnf /etc/pf.conf                     # dry-run 校验语法
sudo pfctl -f /etc/pf.conf                       # reload
sudo pfctl -a cecelia-security -s rules          # 看实际加载的规则
# 验证：外部从 us-vps 测公网端口是否被封；本机 localhost / tailnet 应仍通
```

## 加固记录（2026-06-13/14）

1. **公网 SSH 关密码登录** —— drop-in `/etc/ssh/sshd_config.d/010-hardening.conf`（`PasswordAuthentication no` + `KbdInteractiveAuthentication no` + `PermitRootLogin prohibit-password`）。macOS sshd 由 launchd 按连接拉起，改完即时生效。
2. **VNC 公网爆破止血** —— 5900 曾监听 `*:5900` 公网裸奔，被全网扫描器持续爆破（认证失败，无 breach；排查无后门/陌生账户/恶意 cron）。已停服务 + 禁用 ARD。
3. **修复并启用 pf 防火墙** —— 见上（语法 bug + 开机持久化）。
4. **Brain 控制台 API（5221）公网封禁** —— 曾无认证全开。方案：CI（GitHub 云端 runner）经 `tailscale/github-action`（authkey=`secrets.TS_AUTHKEY`，tag:ci）入 tailnet 连 `100.71.151.105:5221`（cecelia PR #3382），随后 pf 封公网 5221。Brain 跑在 OrbStack 容器（Docker NAT 致 token 方案需改造所有本机调用方，故否决）。
5. **统一 Tailscale 登录** —— 各机走 Tailscale 名 + 1Password 共用 key，不写公网 IP。

## 凭据位置

- Tailscale API key：1Password CS vault「Tailscale」条目 notes `TAILSCALE_API_KEY`
- 写 GitHub Actions Secret：用 1Password CS「GitHub Tokens」的 `GITHUB_CLASSIC_TOKEN`（`ghp_`，有 repo scope；gh 默认 PAT 无 secrets scope 会 403）
- CI 入 tailnet 的 `TS_AUTHKEY`：已写入 `perfectuser21/cecelia` + `perfectuser21/zenithjoy-workspace` repo secrets

## 已知遗留 / 可选加固

- **自动登录开着**（autoLoginUser=administrator）、**FileVault 关闭** —— 取舍待定
- `authorized_keys` 第 8 行 hk-vps key 重复，可去重
- 7786 / 9998 是**无认证开放端口**，要更严可加 token 校验或 IP 白名单（代码活）
- zenithjoy-workspace main 的 Brain P0 告警用 `secrets.BRAIN_URL`（未设=空 no-op），要真生效需设为 Tailscale IP + 加 tailscale step
