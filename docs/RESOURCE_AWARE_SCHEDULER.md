# 资源感知调度系统

## 一、当前问题

### 硬编码席位的问题

```
配置: MAX_CONCURRENT = 6
现实: 6 个 claude 进程在 8 核 15GB 机器上 = 已经吃紧

问题:
1. 固定 6 个席位，不管实际资源
2. CPU 100% 了还在派发 → 死机风险
3. 香港服务器空着没用
```

---

## 二、双服务器架构

### 服务器定位

| 服务器 | 角色 | 资源 | 适合任务 |
|--------|------|------|----------|
| **US VPS** | 主力 | 8核 15GB | dev, review (需要完整工具链) |
| **HK VPS** | 辅助 | 4核 7.6GB | talk, research (轻量只读) |

### 为什么 HK 适合轻量任务？

```
talk (日报):
- Plan Mode，只读 + 写 markdown
- 不需要 git push, npm, docker
- 内存占用低

research (调研):
- Plan Mode，纯只读
- 不改任何文件
- 可以慢一点

automation:
- 调 N8N API
- N8N 就在 HK
- 网络延迟更低
```

### 不适合放 HK 的任务

```
dev:
- 需要完整开发环境
- 需要 git push 到 GitHub (HK → GitHub 慢)
- 需要 npm install, docker 等

review:
- 需要读取完整代码库
- 可能需要运行测试
- 代码库在 US
```

---

## 三、动态席位计算

### 资源感知公式

```javascript
function calculateAvailableSlots(server) {
  const cpuCores = os.cpus().length;
  const loadAvg = os.loadavg()[0];  // 1分钟平均负载
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsedPct = (memTotal - memFree) / memTotal * 100;

  // 每个 Claude 进程大约需要:
  // - 1 核 CPU (峰值可达 1.5)
  // - 1.5GB RAM
  const CPU_PER_CLAUDE = 1.2;
  const MEM_PER_CLAUDE_GB = 1.5;

  // 计算 CPU 允许的最大进程数
  const cpuHeadroom = Math.max(0, cpuCores - loadAvg);
  const cpuAllowedSlots = Math.floor(cpuHeadroom / CPU_PER_CLAUDE);

  // 计算内存允许的最大进程数
  const memFreeGB = memFree / (1024 * 1024 * 1024);
  const memReserveGB = 2;  // 保留 2GB 给系统
  const memAllowedSlots = Math.floor((memFreeGB - memReserveGB) / MEM_PER_CLAUDE_GB);

  // 取最小值，再加上安全边际
  const rawSlots = Math.min(cpuAllowedSlots, memAllowedSlots);
  const safeSlots = Math.max(0, rawSlots - 1);  // 再减 1 作为缓冲

  // 硬上限
  const maxSlots = server === 'us' ? 5 : 2;

  return Math.min(safeSlots, maxSlots);
}
```

### 示例计算

**US VPS 当前状态:**
```
CPU: 8 核, load 6.0 (6 个进程在跑)
RAM: 15GB total, 11GB available

cpuHeadroom = 8 - 6 = 2
cpuAllowedSlots = 2 / 1.2 = 1.6 → 1

memFreeGB = 11GB
memAllowedSlots = (11 - 2) / 1.5 = 6

safeSlots = min(1, 6) - 1 = 0  ← 不能再派发了！
```

**HK VPS 当前状态:**
```
CPU: 4 核, load 0.5 (只有 PostgreSQL)
RAM: 7.6GB total, 6.2GB available

cpuHeadroom = 4 - 0.5 = 3.5
cpuAllowedSlots = 3.5 / 1.2 = 2.9 → 2

memFreeGB = 6.2GB
memAllowedSlots = (6.2 - 2) / 1.5 = 2.8 → 2

safeSlots = min(2, 2) - 1 = 1  ← 可以跑 1 个轻量任务
```

---

## 四、防死机机制

### 多层保护

```
Layer 1: 派发前检查
├── CPU load > 80% cores → 不派发
├── Memory < 20% → 不派发
└── Swap > 50% → 不派发

Layer 2: 动态席位
├── 不是固定 6 个
├── 根据实时资源计算可用席位
└── 可能是 0-5 之间任何数

Layer 3: 运行时监控
├── 每 30 秒检查一次系统负载
├── 如果危险，暂停派发
└── 如果极端危险，kill 最低优先级任务

Layer 4: 熔断器
├── 连续 3 次任务失败 → 暂停派发 5 分钟
├── 系统恢复后自动重试
└── 防止雪崩效应
```

### 危险等级定义

| 等级 | CPU Load | Memory Free | Swap Used | 动作 |
|------|----------|-------------|-----------|------|
| 🟢 正常 | < 60% | > 30% | < 30% | 正常派发 |
| 🟡 警告 | 60-80% | 20-30% | 30-50% | 只派发高优先级 |
| 🟠 危险 | 80-90% | 10-20% | 50-70% | 暂停派发 |
| 🔴 紧急 | > 90% | < 10% | > 70% | Kill 低优先级任务 |

### 紧急降级代码

```javascript
async function emergencyDegradation() {
  const status = getSystemStatus();

  if (status.level === 'critical') {
    console.error('[EMERGENCY] System critical, killing low-priority tasks');

    // 按优先级排序当前任务
    const tasks = getRunningTasks().sort((a, b) =>
      getTaskScore(a) - getTaskScore(b)  // 得分低的先 kill
    );

    // Kill 得分最低的任务，直到资源恢复
    for (const task of tasks) {
      if (task.task_type === 'research' || task.task_type === 'talk') {
        await killTask(task.id, 'emergency_degradation');
        await sleep(5000);

        const newStatus = getSystemStatus();
        if (newStatus.level !== 'critical') break;
      }
    }
  }
}
```

---

## 五、跨服务器调度

### 架构图

```
┌─────────────────────────────────────────────────────────────┐
│                    Cecelia Brain (US)                        │
│                                                             │
│  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐ │
│  │  Scheduler  │ ───► │  US Executor│ ───► │ US Claude   │ │
│  │             │      │  (local)    │      │ Processes   │ │
│  │             │      └─────────────┘      └─────────────┘ │
│  │             │                                            │
│  │             │      ┌─────────────┐      ┌─────────────┐ │
│  │             │ ───► │  HK Bridge  │ ───► │ HK Claude   │ │
│  │             │      │  (remote)   │      │ Processes   │ │
│  └─────────────┘      └─────────────┘      └─────────────┘ │
│         │                    │                              │
│         │                    │ SSH Tunnel / API             │
│         ▼                    ▼                              │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              PostgreSQL (HK)                         │   │
│  │              - Tasks, Goals, Status                  │   │
│  └─────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

### 任务路由决策

```javascript
function selectServer(task) {
  // 1. 检查任务类型约束
  const typeConstraints = {
    dev: ['us'],           // 只能在 US
    review: ['us'],        // 只能在 US
    automation: ['hk', 'us'],  // 优先 HK (N8N 在那)
    talk: ['hk', 'us'],    // 优先 HK (轻量)
    research: ['hk', 'us'] // 优先 HK (轻量)
  };

  const allowedServers = typeConstraints[task.task_type] || ['us'];

  // 2. 检查各服务器可用席位
  const usSlots = calculateAvailableSlots('us');
  const hkSlots = calculateAvailableSlots('hk');

  // 3. 选择有空位的服务器
  for (const server of allowedServers) {
    const slots = server === 'us' ? usSlots : hkSlots;
    if (slots > 0) {
      return server;
    }
  }

  // 4. 都满了，返回 null
  return null;
}
```

### HK Bridge 部署

```bash
# 在 HK 服务器部署 cecelia-bridge
ssh hk

# 安装 Node.js (如果没有)
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# 部署 bridge
mkdir -p ~/bin
cat > ~/bin/cecelia-bridge.js << 'EOF'
// HK 版本的 cecelia-bridge
// 只接受 talk, research, automation 任务
const ALLOWED_TYPES = ['talk', 'research', 'automation'];
// ... 其余代码类似 US 版本
EOF

# 启动
node ~/bin/cecelia-bridge.js &
```

---

## 六、统一监控

### 双服务器状态 API

```javascript
// GET /api/brain/cluster/status
{
  "servers": {
    "us": {
      "online": true,
      "cpu_cores": 8,
      "cpu_load": 6.2,
      "mem_total_gb": 15,
      "mem_free_gb": 11,
      "slots_max": 5,
      "slots_available": 0,
      "slots_in_use": 5,
      "tasks_running": ["task-1", "task-2", ...]
    },
    "hk": {
      "online": true,
      "cpu_cores": 4,
      "cpu_load": 0.5,
      "mem_total_gb": 7.6,
      "mem_free_gb": 6.2,
      "slots_max": 2,
      "slots_available": 1,
      "tasks_running": []
    }
  },
  "cluster_status": "partial",  // healthy / partial / degraded
  "total_slots": 7,
  "available_slots": 1,
  "recommendation": "US 满载, 轻量任务可路由到 HK"
}
```

### 前端显示

```
┌─────────────────────────────────────────────────────────────┐
│  Cluster Status: 🟡 Partial                                  │
│                                                             │
│  US VPS (主力)                    HK VPS (辅助)              │
│  ████████░░ 6.2/8 CPU            █░░░░░░░ 0.5/4 CPU         │
│  ███████░░░ 73% MEM              ██░░░░░░ 18% MEM           │
│  Slots: 5/5 🔴                   Slots: 0/2 🟢              │
│                                                             │
│  Running Tasks:                   Available for:            │
│  - dev: PR Feature A              - talk (日报)             │
│  - dev: Bug Fix #123              - research                │
│  - dev: Refactor X                - automation              │
│  - review: Code Audit             │
│  - automation: Backup             │
└─────────────────────────────────────────────────────────────┘
```

---

## 七、配置汇总

```javascript
// brain/src/scheduler-config.js

export const CLUSTER_CONFIG = {
  servers: {
    us: {
      name: 'US VPS',
      host: 'localhost',  // Brain 在这里运行
      bridgePort: 3457,
      maxSlots: 5,
      reservedSlots: 1,
      allowedTypes: ['dev', 'review', 'automation', 'talk', 'research'],
      priority: 1  // 优先使用
    },
    hk: {
      name: 'HK VPS',
      host: '100.86.118.99',  // Tailscale IP
      bridgePort: 3457,
      maxSlots: 2,
      reservedSlots: 0,
      allowedTypes: ['talk', 'research', 'automation'],
      priority: 2  // 次选
    }
  },

  // 资源阈值
  resources: {
    cpuPerProcess: 1.2,
    memPerProcessGB: 1.5,
    memReserveGB: 2,
    loadWarningPct: 60,
    loadDangerPct: 80,
    loadCriticalPct: 90,
    memWarningPct: 30,
    memDangerPct: 20,
    memCriticalPct: 10
  },

  // 熔断器
  circuitBreaker: {
    failureThreshold: 3,
    cooldownMinutes: 5
  }
};
```

---

## 八、实现优先级

### 必须先做 (防死机)

1. [ ] 动态席位计算 (替代硬编码 6)
2. [ ] 多层资源检查
3. [ ] 紧急降级机制

### 其次 (提升效率)

4. [ ] HK Bridge 部署
5. [ ] 跨服务器任务路由
6. [ ] 统一监控 API

### 最后 (完善体验)

7. [ ] 前端集群状态显示
8. [ ] 自动故障转移
9. [ ] 性能分析报告
