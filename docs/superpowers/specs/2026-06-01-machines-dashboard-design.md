# Machines Dashboard Design

**日期：** 2026-06-01  
**状态：** 待实现  
**范围：** Cecelia Dashboard 新增 `/machines` 设备管理页面

---

## 背景与问题

当前设备信息分散在 Memory.md、CLAUDE.md 和开发者记忆中，存在以下问题：

1. **网络路径不透明**：哪台机器走哪个 exit node 没有集中记录，西安 M4 走美国 exit node 但同时跑着需要中国 IP 的服务，产生隐性冲突
2. **服务状态不明**：废弃服务（如 clawdbot）没有标记，长期混在正式服务中
3. **记忆依赖**：新功能部署在哪台机器上只有操作者知道，时间一长无从追溯

**解决方案：** 基于现有 `system_registry` 表，在 Cecelia Dashboard 新建设备管理页面，展示每台机器的完整状态、网络配置和服务列表。

---

## 设备清单（8 台常驻机器）

| 名称 | Tailscale 名 | Tailscale IP | 位置 | OS |
|---|---|---|---|---|
| 美国 M4 | mac-mini-m4-us | 100.71.151.105 | 美国 | macOS |
| 西安 M1 | mac-mini-m1-us（命名有误） | 100.88.166.55 | 西安 | macOS |
| 西安 M4 | mac-mini-m4-xian | 100.86.57.69 | 西安 | macOS |
| 西安 PC | XIAN-PC | 100.97.242.124 | 西安 | Windows |
| 西安 ROG | XX-ROG | 100.98.253.95 | 西安 | Windows |
| 西安 NAS | ZenithJoy_NAS | 100.110.241.76 | 西安 | Linux |
| 香港 VPS | VM-0-8-ubuntu | 100.86.118.99 | 香港 | Linux |
| 美国 VPS | sf-vps | 100.79.41.61 | 美国 | Linux |

---

## 数据层

### 存储位置

复用现有 `system_registry` 表（migration 197），`type = 'machine'`。

### metadata JSONB 完整结构

```json
{
  "hardware": "Mac mini M4",
  "os": "macOS",
  "tailscale_name": "mac-mini-m4-xian",
  "tailscale_ip": "100.86.57.69",
  "public_ip": "117.36.7.184",
  "ssh_alias": "xian-mac",
  "ssh_user": "jinnuoshengyuan",

  "exit_node": "vps-us",
  "exit_node_ip": "134.199.234.147",
  "effective_country": "US",
  "socks_proxy": "127.0.0.1:1080",
  "ssh_tunnels": ["vps-hk"],

  "role": "Codex 执行机",
  "tags": ["codex", "xian"],
  "accounts": ["codex-team3", "codex-team4", "codex-team5"],

  "services": [
    {
      "name": "Codex Bridge",
      "port": 3457,
      "type": "launchd",
      "needs_cn_ip": false,
      "description": "接收 Brain 任务，调用 Codex CLI"
    },
    {
      "name": "PostgreSQL",
      "port": 5432,
      "type": "homebrew",
      "internal": true
    }
  ],

  "deprecated": [
    {
      "name": "clawdbot",
      "reason": "小龙虾项目暂停，待卸载"
    }
  ],

  "notes": "exit node 走美国，Codex 访问 OpenAI 正常"
}
```

### 初始数据（需写入 DB 的 8 条记录）

**美国 M4**
```json
{
  "hardware": "Mac mini M4", "os": "macOS",
  "tailscale_name": "mac-mini-m4-us", "tailscale_ip": "100.71.151.105",
  "public_ip": "38.23.47.81", "ssh_alias": "mmv", "ssh_user": "administrator",
  "exit_node": null, "effective_country": "US",
  "role": "主力研发机",
  "tags": ["brain", "claude-code", "codex"],
  "accounts": ["codex-team1", "codex-team2"],
  "services": [
    { "name": "Brain API", "port": 5221, "type": "orbstack", "needs_cn_ip": false, "description": "核心任务调度 API" },
    { "name": "Cecelia Bridge", "port": 3457, "type": "launchd", "needs_cn_ip": false, "description": "本机 Codex 调度桥" },
    { "name": "PostgreSQL", "port": 5432, "type": "orbstack", "internal": true }
  ]
}
```

**西安 M1**
```json
{
  "hardware": "Mac mini M1", "os": "macOS",
  "tailscale_name": "mac-mini-m1-us", "tailscale_ip": "100.88.166.55",
  "public_ip": "117.36.7.184", "ssh_alias": "xian-m1", "ssh_user": "xx-macmini",
  "exit_node": null, "effective_country": "CN",
  "role": "RPA 执行机（社媒发布）",
  "tags": ["rpa", "xian", "chrome"],
  "services": [
    { "name": "Chrome XHS", "type": "launchd", "needs_cn_ip": true, "description": "小红书 RPA 浏览器" },
    { "name": "Chrome Douyin", "type": "launchd", "needs_cn_ip": true, "description": "抖音 RPA 浏览器" },
    { "name": "L4 Monitor", "type": "launchd", "needs_cn_ip": false, "description": "网络层监控" },
    { "name": "SOCKS Proxy", "port": 1080, "type": "launchd", "description": "SSH tunnel → vps-hk" }
  ],
  "ssh_tunnels": ["vps-hk"],
  "notes": "命名有误（含 us），实际在西安，走中国直连"
}
```

**西安 M4**
```json
{
  "hardware": "Mac mini M4", "os": "macOS",
  "tailscale_name": "mac-mini-m4-xian", "tailscale_ip": "100.86.57.69",
  "public_ip": "117.36.7.184", "ssh_alias": "xian-mac", "ssh_user": "jinnuoshengyuan",
  "exit_node": "vps-us", "exit_node_ip": "134.199.234.147", "effective_country": "US",
  "socks_proxy": "127.0.0.1:1080", "ssh_tunnels": ["vps-hk"],
  "role": "Codex 执行机",
  "tags": ["codex", "xian"],
  "accounts": ["codex-team3", "codex-team4", "codex-team5"],
  "services": [
    { "name": "Codex Bridge", "port": 3457, "type": "launchd", "needs_cn_ip": false, "description": "接收 Brain 任务，调用 Codex CLI" },
    { "name": "PostgreSQL", "port": 5432, "type": "homebrew", "internal": true }
  ],
  "deprecated": [{ "name": "clawdbot", "reason": "小龙虾项目暂停，待卸载" }],
  "notes": "exit node 走美国，Codex 访问 OpenAI 正常"
}
```

**西安 PC**
```json
{
  "hardware": "PC", "os": "Windows",
  "tailscale_name": "XIAN-PC", "tailscale_ip": "100.97.242.124",
  "ssh_alias": "xian-pc",
  "exit_node": null, "effective_country": "CN",
  "role": "Windows RPA 执行机",
  "tags": ["rpa", "xian", "windows"],
  "services": []
}
```

**西安 ROG**
```json
{
  "hardware": "ROG 台式机", "os": "Windows",
  "tailscale_name": "XX-ROG", "tailscale_ip": "100.98.253.95",
  "ssh_alias": "xian-rog",
  "exit_node": null, "effective_country": "CN",
  "role": "Windows RPA 备用机",
  "tags": ["rpa", "xian", "windows"],
  "services": []
}
```

**西安 NAS**
```json
{
  "hardware": "NAS", "os": "Linux",
  "tailscale_name": "ZenithJoy_NAS", "tailscale_ip": "100.110.241.76",
  "role": "文件存储 & 内容同步",
  "tags": ["nas", "xian", "storage"],
  "services": [
    { "name": "文件存储", "description": "内容素材、视频文件存储" },
    { "name": "NAS Content Manager", "description": "内容同步脚本" }
  ]
}
```

**香港 VPS**
```json
{
  "hardware": "VPS 4核8GB", "os": "Linux",
  "tailscale_name": "VM-0-8-ubuntu", "tailscale_ip": "100.86.118.99",
  "public_ip": "124.156.138.116", "ssh_alias": "hk-vps",
  "exit_node": null, "effective_country": "HK",
  "offers_exit_node": true,
  "role": "公网入口 & AI 执行节点",
  "tags": ["vps", "hk", "exit-node", "docker"],
  "services": [
    { "name": "Cecelia Bridge (HK)", "port": 5225, "type": "systemd", "needs_cn_ip": false, "description": "HK 节点任务桥" },
    { "name": "MiniMax Executor", "port": 5226, "type": "systemd", "needs_cn_ip": false, "description": "MiniMax API 执行器 v2.0" },
    { "name": "Brain Proxy", "port": 5221, "type": "socat", "description": "转发到美国 M4 Brain API" },
    { "name": "Cecelia Core", "port": 5211, "type": "docker", "description": "Cecelia 核心服务" },
    { "name": "Cecelia Frontend", "port": 5212, "type": "docker", "description": "Cecelia 前端" },
    { "name": "Autopilot Dashboard", "port": 80, "type": "docker", "description": "自动驾驶仪 dashboard" },
    { "name": "Autopilot Dev", "port": 520, "type": "docker" },
    { "name": "Xray Reality", "port": 8443, "type": "docker", "description": "VPN 入口节点" },
    { "name": "Xray Relay", "port": 18443, "type": "docker", "description": "VPN 中继" },
    { "name": "VPN Subscription", "port": 8080, "type": "docker", "description": "VPN 订阅服务 ⚠️ unhealthy" },
    { "name": "Feishu Login", "type": "docker", "description": "飞书登录服务" },
    { "name": "Cloudflare Tunnel", "type": "docker", "description": "Cloudflare 内网穿透" },
    { "name": "流量密码 Data Deck", "port": 8899, "type": "python", "description": "流量分析 dashboard" }
  ]
}
```

**美国 VPS**
```json
{
  "hardware": "VPS 1核2GB", "os": "Linux",
  "tailscale_name": "sf-vps", "tailscale_ip": "100.79.41.61",
  "public_ip": "134.199.234.147", "ssh_alias": "us-vps",
  "exit_node": null, "effective_country": "US",
  "offers_exit_node": true,
  "role": "Tailscale Exit Node & ZenithJoy 生产",
  "tags": ["vps", "us", "exit-node", "zenithjoy"],
  "services": [
    { "name": "ZenithJoy API", "port": 5200, "type": "docker", "internal": true, "description": "ZenithJoy 后端 API" },
    { "name": "ZenithJoy PostgreSQL", "type": "docker", "internal": true },
    { "name": "Xray Reality", "port": 443, "type": "docker", "description": "VPN 出口节点" },
    { "name": "VPN Subscription", "port": 8080, "type": "docker" },
    { "name": "Cloudflare Tunnel", "type": "docker" }
  ]
}
```

---

## Backend API

### 新增端点

**`GET /api/brain/machines`**  
返回所有 `type = 'machine'` 的 system_registry 记录，附加实时 Tailscale 状态。

```json
[
  {
    "id": "...",
    "name": "mac-mini-m4-xian",
    "description": "西安 Mac mini M4，Codex 主力机",
    "status": "active",
    "metadata": { ... },
    "tailscale_online": true,
    "tailscale_last_seen": "2026-06-01T10:00:00Z",
    "conflicts": [
      {
        "service": "clawdbot",
        "type": "deprecated",
        "message": "废弃服务未清理"
      }
    ]
  }
]
```

**实现：** 查 `system_registry WHERE type='machine'`，同时 shell exec `tailscale status --json`，按 tailscale_ip 匹配在线状态。冲突检测在 Brain 后端计算，不在前端做。

**`GET /api/brain/machines/:name`**  
单台机器详情，同上格式。

**`PATCH /api/brain/machines/:name`**  
更新 metadata 字段（支持部分更新），用于前端内联编辑。

---

## 冲突检测规则

后端在 `/api/brain/machines` 响应时计算 `conflicts` 数组：

| 规则 | 条件 | 严重程度 |
|---|---|---|
| IP 冲突 | `service.needs_cn_ip = true` 且 `effective_country ≠ 'CN'` | error |
| 废弃服务 | `deprecated` 数组非空 | warning |
| 订阅服务不健康 | service description 含 `unhealthy` | warning |
| Tailscale 离线 | `tailscale_online = false` | info |

---

## 前端页面

### 页面一：`/machines` 概览

**顶部汇总条：**
```
8 台设备  ·  7 在线  ·  1 个冲突  ·  2 个废弃服务
```

**卡片网格，按地区分组（西安 / 美国 / 香港）：**

每张卡片：
- 机器名 + 在线状态（🟢 / 🔴 / ⚫ 离线）
- 角色描述（一行）
- 出口国家（🇺🇸 🇨🇳 🇭🇰）+ exit node 名称
- 服务数量 + 冲突/废弃提示
- [查看详情 →] 按钮

冲突时卡片顶部显示红色边框。

### 页面二：`/machines/:name` 详情

分区块展示：

**区块 1：基础信息**（在线状态、硬件、OS、SSH 连接命令）

**区块 2：网络配置**
- Tailscale IP / 公网 IP
- 出口国家（带图标）
- Exit Node（如无则显示"直连"）
- SOCKS Proxy / SSH Tunnels

**区块 3：账号 & 职责**
- 角色描述
- 关联账号列表（如 codex-team3/4/5）
- 备注

**区块 4：正式服务列表（表格）**

| 服务名 | 端口 | 类型 | IP 要求 | 状态 |
|---|---|---|---|---|
| Codex Bridge | 3457 | launchd | 🇺🇸 美国 | 🟢 ✓ 匹配 |
| PostgreSQL | 5432 | homebrew | 内网 | 🟢 |

IP 要求与实际出口不匹配时，该行标红 ⛔。

**区块 5：废弃服务**
- 列表显示废弃原因
- [标记已处理] 按钮（从 deprecated 数组移除）

**区块 6：关联关系**（如"任务派发来自 Brain on 美国 M4"）

每个字段右侧有铅笔图标，点击可内联编辑，保存后 PATCH `/api/brain/machines/:name`。

---

## 实现步骤

1. **Brain migration**：新建 migration，INSERT 8 条机器数据到 `system_registry`（补齐西安 PC、ROG、NAS，更新已有 5 条的 metadata）
2. **Brain 路由**：新增 `GET /api/brain/machines`、`GET /api/brain/machines/:name`、`PATCH /api/brain/machines/:name` 三个端点，含 Tailscale 状态叠加和冲突检测
3. **Dashboard 概览页**：`/machines` 路由 + 卡片组件，从 Brain API 拉数据
4. **Dashboard 详情页**：`/machines/:name` 路由 + 分区块详情组件，内联编辑支持
5. **导航**：在 Dashboard 侧边栏加"设备"入口
