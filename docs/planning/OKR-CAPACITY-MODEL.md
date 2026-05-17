---
id: okr-capacity-model
version: 1.1.0
created: 2026-03-04
updated: 2026-03-04
changelog:
  - 1.0.0: 初始版本 - OKR 产能模型框架
  - 1.1.0: 补充真实设备数据、Tailscale 网络拓扑、Token 约束分析
---

# OKR 产能模型

Cecelia 自主运行的产能规划模型。基于真实硬件资源、Token 预算、Agent 并发能力，推算每月/每季可完成的 Initiative 数量。

---

## 1. 硬件资源清单

### 1.1 服务器

| 设备 | 提供商 | 位置 | CPU | 内存 | 存储 | 系统 | 公网 IP | Tailscale IP | 角色 |
|------|--------|------|-----|------|------|------|---------|-------------|------|
| 美国 VPS | DigitalOcean NYC | 纽约 | 8 核 | 16 GB | 320 GB SSD | Ubuntu 22.04 | 146.190.52.84 | 100.71.32.28 | 研发中心 |
| 香港 VPS | 腾讯云 | 香港 | 4 核 | 8 GB | 待确认 | Ubuntu 22.04 | 124.156.138.116 | 100.86.118.99 | 生产中心 |

### 1.2 西安公司设备

| 设备 | 型号 | 系统 | Tailscale IP | 角色 |
|------|------|------|-------------|------|
| Mac mini | Mac mini 4 | macOS | 100.86.57.69 | 开发设备、内容生成 |
| Node PC | Windows PC | Windows | 100.97.242.124 | 计算设备、后台任务 |
| NAS | Synology（群晖） | DSM | 100.110.241.76 | 视频素材存储、文件共享 |

### 1.3 当前资源使用

| 设备 | 运行服务 | 资源占用 | 可用余量 |
|------|----------|----------|----------|
| 美国 VPS | Cecelia Brain (5221), Workspace (5211), PostgreSQL (5432), N8N (5679), VPN (443) | ~60% CPU, ~10 GB RAM | 可运行 2-3 个并发 Agent |
| 香港 VPS | ZenithJoy Dashboard (5211), PostgreSQL (5432), VPN (443) | ~30% CPU, ~4 GB RAM | 可运行 1-2 个轻量服务 |
| Mac mini | 空闲 | 低 | 可作为备用计算节点 |
| Node PC | 空闲 | 低 | 可作为备用计算节点 |
| NAS | 文件存储 | 低 | 仅存储用途 |

---

## 2. Tailscale 网络拓扑

所有设备通过 Tailscale 100.x.x.x 内网互联，形成一个安全的私有网络。

```
                    ┌─────────────────────────┐
                    │       Tailscale Mesh     │
                    └────────────┬────────────┘
                                 │
        ┌────────────────────────┼────────────────────────┐
        │                        │                        │
        ▼                        ▼                        ▼
┌───────────────┐      ┌───────────────┐      ┌───────────────────┐
│  美国 VPS      │      │  香港 VPS      │      │  西安公司          │
│  (研发中心)    │      │  (生产中心)    │      │                   │
│               │      │               │      │  Mac mini          │
│  100.71.32.28 │◄────►│ 100.86.118.99 │◄────►│  100.86.57.69      │
│               │      │               │      │                   │
│  Brain/N8N    │      │  Dashboard    │      │  Node PC           │
│  PostgreSQL   │      │  PostgreSQL   │      │  100.97.242.124    │
│  Claude Code  │      │  VPN          │      │                   │
│               │      │               │      │  NAS               │
│               │      │               │      │  100.110.241.76    │
└───────────────┘      └───────────────┘      └───────────────────┘
```

### 关键路径

| 路径 | 方式 | 延迟 | 用途 |
|------|------|------|------|
| 美国 VPS <-> 香港 VPS | Tailscale 直连 | ~180ms | 部署同步 (rsync) |
| 美国 VPS <-> 西安设备 | Tailscale | ~200ms | 远程管理 |
| 香港 VPS <-> 西安设备 | Tailscale | ~30ms | 生产访问 |

### 部署流程

```
研发（美国 VPS）──── rsync over Tailscale ────► 生产（香港 VPS）
                   deploy.sh hk
```

---

## 3. Token 约束分析

### 3.1 当前 LLM 资源

| 资源 | 数量 | 位置 | 用途 | 月成本 |
|------|------|------|------|--------|
| Claude Max 账号 | 3 个 | 美国 VPS | 研发 Agent（/dev, /okr, /review 等） | $200 x 3 |
| MiniMax 包月 | 1 个 | 美国 VPS (Brain) | 事实提取、轻量 JSON 处理 | 包月固定 |

### 3.2 Claude Max 账号分配

| 账号 | 主要用途 | 并发能力 |
|------|----------|----------|
| account-1 | Cecelia 自主派发任务 | 1 个 headless agent |
| account-2 | Cecelia 自主派发任务 | 1 个 headless agent |
| account-3 | 用户有头开发 + Cecelia 备用 | 1 个 headed/headless |

**Claude Max 限制**：每个账号有速率限制（Opus 模型约 45 条消息/5 小时窗口），3 个账号轮转可缓解但不能完全消除瓶颈。

### 3.3 并发瓶颈分析

```
当前最大并发 Agent 数 = 3（受 Claude Max 账号数限制）

每个 Agent 一次处理 1 个 Task（/dev PR 流程 ~30-60 min）

理论日吞吐 = 3 个 Agent x (24h / 0.75h) = ~96 tasks/day
实际日吞吐 = ~30-50 tasks/day（考虑速率限制、CI 等待、失败重试）
```

### 3.4 扩容分析

如果并发需求 >3 个 slot（例如：用户有头开发 + Cecelia 同时派发 3 个任务 = 4 slot）：

| 方案 | 可行性 | 成本 | 效果 |
|------|--------|------|------|
| 新增 Claude Max 账号 | 高 | +$200/月/账号 | +1 并发 slot |
| 使用 Anthropic API Key | 中 | 按量计费 | 灵活但贵 |
| 引入 MiniMax 执行简单任务 | 中 | 低 | 释放 Claude 给复杂任务 |
| 优化任务排队策略 | 高 | 无 | 减少空闲浪费 |

**当前结论**：3 个 Claude Max 账号在当前阶段足够。当 Cecelia 自主任务稳定超过 50 tasks/day 时，考虑扩容到 4-5 个账号。

---

## 4. Agent 并发模型

### 4.1 Slot 定义

```
1 Slot = 1 个独立的 Claude Code 会话（headed 或 headless）
       = 1 个 Claude Max 账号
       = 1 个 Git Worktree（代码隔离）
```

### 4.2 当前 Slot 布局

| Slot | 账号 | 模式 | 分配 |
|------|------|------|------|
| Slot 1 | account-1 | headless | Cecelia 自主派发 |
| Slot 2 | account-2 | headless | Cecelia 自主派发 |
| Slot 3 | account-3 | headed | 用户手动开发 / Cecelia 备用 |

### 4.3 月度产能估算

```
假设：
- 每个 Task 平均耗时 45 分钟（含 CI 等待）
- 每天有效运行 20 小时（4 小时维护/降级）
- 3 个 Slot 同时运行

月度产能 = 3 slots x (20h / 0.75h) x 30 days
         = 3 x 26.7 x 30
         = ~2400 tasks/month（理论上限）

实际产能（考虑失败、重试、速率限制）:
         = ~800-1200 tasks/month

每个 Initiative 约 3-5 个 Task:
         = ~200-400 initiatives/month（理论）
         = ~60-120 initiatives/month（实际）
```

---

## 5. 资源瓶颈排序

| 排序 | 瓶颈 | 影响 | 缓解方案 |
|------|------|------|----------|
| 1 | Claude Max 速率限制 | 每 5h 窗口有消息上限 | 3 账号轮转 + 降级到 Sonnet |
| 2 | CI 等待时间 | GitHub Actions 排队 + 运行 ~5min | 使用 ubuntu-latest 减少排队 |
| 3 | 美国 VPS CPU | 多 Agent + Brain + DB 争抢 | 监控 watchdog，必要时升配 |
| 4 | Git 冲突 | 并行 PR 版本碰撞 | Worktree 隔离 + 自动冲突解决 |
| 5 | PostgreSQL 连接数 | Brain + N8N + 多 Agent 并发 | 连接池优化，当前足够 |

---

## 6. 扩容路线图

### Phase 1（当前）

- 3 个 Claude Max 账号
- 2-3 个 headless slot + 1 个 headed slot
- 月度产能：60-120 initiatives

### Phase 2（当并发需求 > 3）

- 增加到 5 个 Claude Max 账号
- 升级美国 VPS 到 16 核 32 GB
- 月度产能：120-200 initiatives

### Phase 3（长期）

- 引入 API Key 弹性扩容
- 西安设备作为计算节点
- 香港 VPS 分担部分 Agent
- 月度产能：200+ initiatives

---

## 7. 监控指标

| 指标 | 来源 | 阈值 |
|------|------|------|
| 日完成 Task 数 | Brain DB tasks 表 | >30 正常，<10 告警 |
| Agent 空闲率 | Brain tick 日志 | <30% 正常，>70% 浪费 |
| Claude Max 降级次数 | account-usage.js | <5/day 正常 |
| CI 平均等待时间 | GitHub Actions API | <10min 正常 |
| 美国 VPS CPU | watchdog API | <80% 正常 |
| 美国 VPS RAM | watchdog API | <90% 正常 |
