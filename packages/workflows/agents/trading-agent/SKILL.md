---
version: 1.0.0
created: 2026-02-11
updated: 2026-02-11
changelog:
  - 1.0.0: 初始版本 - Trading Agent Skill（Cecelia 集成）
---

# Trading Agent Skill

**24/7 自动交易代理，由 Cecelia 调度和监控。**

---

## 🎯 核心职责

Trading Agent 是 Cecelia 管家系统的"交易员工"，负责：

1. **盯盘监控** - 实时追踪市场行情
2. **智能决策** - 通过 Cecelia Brain 做出交易决策
3. **执行交易** - 通过 IBKR API 执行买卖
4. **风险控制** - 止损、止盈、仓位管理
5. **每日汇报** - 向 Cecelia 汇报交易结果

---

## 🔧 触发方式

### 1. Cecelia Tick Loop 自动调度（24/7）

```bash
# 盘前准备（每天 8:00 AM EST）
POST /api/brain/tasks
{
  "title": "Trading: 盘前准备",
  "skill": "/trading-agent",
  "args": "pre-market"
}

# 盘中监控（每 5 分钟，仅在交易时段）
POST /api/brain/tasks
{
  "title": "Trading: 盯盘监控",
  "skill": "/trading-agent",
  "args": "monitor"
}

# 盘后分析（每天 4:30 PM EST）
POST /api/brain/tasks
{
  "title": "Trading: 盘后分析",
  "skill": "/trading-agent",
  "args": "post-market"
}
```

### 2. 手动调用（Claude Code）

```bash
/trading-agent [command]
```

**命令**:
- `pre-market` - 盘前准备
- `monitor` - 实时监控
- `post-market` - 盘后分析
- `status` - 查看当前状态
- `holdings` - 查看持仓
- `performance` - 查看绩效

---

## 📊 工作流程

### 盘前准备 (pre-market)

```
1. 检查 IBKR 连接状态
2. 获取今日经济日历（重大事件）
3. 更新股票池（基本面筛选）
   - PE ratio < 30
   - EPS growth > 15%
   - ROE > 15%
4. 请求 Cecelia Brain: "今日交易策略？"
5. 汇报就绪状态 → Cecelia
```

### 盘中监控 (monitor)

```
1. 获取实时行情（Polygon.io / Yahoo Finance）
2. 检查持仓状态
   - 是否触发止损？（跌幅 > 5%）
   - 是否触发止盈？（涨幅 > 10%）
3. 请求 Cecelia Brain Thalamus: "是否有买入/卖出信号？"
4. 执行交易（如果有信号）
   - 风控检查（仓位、每日亏损限制）
   - 下单 → IBKR API
   - 记录订单 → PostgreSQL
5. 汇报结果 → Cecelia
```

### 盘后分析 (post-market)

```
1. 计算今日绩效
   - 总盈亏（realized + unrealized）
   - 胜率
   - 交易次数
2. 请求 Cecelia Brain Cortex: "今天的交易表现如何？需要调整策略吗？"
3. 生成每日报告
   - 保存 → PostgreSQL (trading_performance)
   - 推送 → Cecelia Dashboard
4. 汇报完成 → Cecelia
```

---

## 🧠 Cecelia Brain 集成

### L0 脑干（代码 - 风控熔断）

```python
def brainstem_check():
    """快速风控检查"""
    # 1. 市场是否开盘？
    if not is_market_open():
        return 'MARKET_CLOSED'

    # 2. 今日亏损是否超过阈值？
    today_loss = get_today_pnl()
    if today_loss < -MAX_DAILY_LOSS:
        return 'CIRCUIT_BREAKER'  # 熔断！

    # 3. IBKR API 是否正常？
    if not check_ibkr_health():
        return 'API_ERROR'

    return 'READY'
```

### L1 丘脑（Sonnet - 快速决策）

```python
async def thalamus_decision(market_data):
    """通过 Cecelia Brain Thalamus 快速决策"""
    response = await requests.post('http://localhost:5221/api/brain/decide', json={
        'context': 'trading_signal',
        'data': market_data,
        'question': '基于当前市场数据，是否有买入/卖出信号？请给出具体建议。'
    })

    # Sonnet 返回:
    # {
    #   "action": "BUY",
    #   "symbol": "AAPL",
    #   "reason": "跌破支撑位后反弹，技术面转强",
    #   "confidence": 0.75
    # }
    return response.json()
```

### L2 皮层（Opus - 深度分析）

```python
async def cortex_analysis(daily_trades):
    """通过 Cecelia Brain Cortex 深度分析"""
    response = await requests.post('http://localhost:5221/api/brain/decide', json={
        'context': 'trading_review',
        'data': daily_trades,
        'question': '今天的交易策略表现如何？有哪些可以改进的地方？'
    })

    # Opus 返回深度分析
    # {
    #   "performance": "今日胜率 60%，但平均盈亏比偏低...",
    #   "suggestions": ["建议提高止盈点", "减少交易频率"],
    #   "risk_assessment": "风险控制良好，无重大问题"
    # }
    return response.json()
```

---

## 🛠️ 技术栈

### Python 模块

| 模块 | 作用 |
|------|------|
| `ib_insync` | IBKR API 客户端 |
| `yfinance` | Yahoo Finance 数据（备用）|
| `pandas` | 数据处理 |
| `ta-lib` | 技术指标计算 |
| `psycopg2` | PostgreSQL 连接 |
| `requests` | Cecelia Brain API 调用 |

### 目录结构

```
~/.claude/skills/trading-agent/
├── SKILL.md              # 本文档
├── scripts/
│   ├── pre_market.py     # 盘前准备
│   ├── monitor.py        # 盯盘监控
│   ├── post_market.py    # 盘后分析
│   ├── execute_trade.py  # 执行交易
│   └── utils.py          # 工具函数
├── config/
│   ├── strategy.json     # 策略配置
│   ├── risk.json         # 风控参数
│   └── .env.example      # 环境变量示例
└── README.md             # 使用说明
```

### 代码仓库

```
/home/xx/perfect21/investment/trading-system/
├── data/                 # 数据采集模块
├── strategy/             # 策略逻辑
├── execution/            # 交易执行
├── cecelia/              # Cecelia 集成
└── database/             # 数据库
```

---

## 🔐 环境变量

```bash
# IBKR 配置
IBKR_HOST=127.0.0.1
IBKR_PORT=7497          # Paper Trading: 7497, Live: 7496
IBKR_CLIENT_ID=1

# Polygon.io API
POLYGON_API_KEY=your_api_key

# Cecelia Brain
CECELIA_BRAIN_URL=http://localhost:5221

# PostgreSQL
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=cecelia
POSTGRES_USER=cecelia
POSTGRES_PASSWORD=your_password

# 风控参数
MAX_DAILY_LOSS=100          # 每日最大亏损（美元）
MAX_POSITION_SIZE=0.2       # 单只股票最大仓位（总资金的 20%）
STOP_LOSS_PERCENT=5         # 止损百分比
TAKE_PROFIT_PERCENT=10      # 止盈百分比
```

---

## 📊 数据库 Schema

见 `/home/xx/perfect21/investment/trading-system/database/schema.sql`

---

## 🚦 风控规则

### 1. 仓位限制

- 单只股票不超过总资金的 **20%**
- 现金储备至少 **20%**

### 2. 止损/止盈

- 止损: 跌幅 > **5%** 自动平仓
- 止盈: 涨幅 > **10%** 自动平仓

### 3. 每日亏损限制

- 单日亏损 > **$100** (或总资金的 2%) → 熔断，停止交易
- 连续 3 天亏损 → 暂停系统，请求人工审查

### 4. 异常监控

- IBKR API 连续失败 > 3 次 → 告警
- 网络中断 > 5 分钟 → 告警
- 订单执行失败 > 2 次 → 告警

---

## 📈 性能目标

| 指标 | 目标 | 说明 |
|------|------|------|
| 年化收益率 | > 10% | 超过 S&P 500 |
| 夏普比率 | > 1.0 | 风险调整后收益 |
| 最大回撤 | < 15% | 最大跌幅 |
| 胜率 | > 55% | 盈利交易占比 |

---

## 📝 使用示例

### 手动触发盘前准备

```bash
cd /home/xx/perfect21/investment/trading-system
python3 -m scripts.pre_market
```

### 查看当前持仓

```bash
/trading-agent holdings
```

### 查看今日绩效

```bash
/trading-agent performance
```

---

## 🐛 故障排查

### 问题: IBKR 连接失败

```bash
# 检查 TWS/IB Gateway 是否运行
ps aux | grep tws

# 检查端口
netstat -an | grep 7497
```

### 问题: Cecelia Brain 调用失败

```bash
# 检查 Cecelia Brain 是否运行
curl http://localhost:5221/api/brain/health

# 查看日志
tail -f /home/xx/perfect21/cecelia/core/brain/logs/brain.log
```

### 问题: PostgreSQL 连接失败

```bash
# 检查 PostgreSQL 是否运行
docker ps | grep postgres

# 测试连接
psql -h localhost -U cecelia -d cecelia
```

---

## 🔄 版本历史

### v1.0.0 (2026-02-11)
- 初始版本
- Cecelia 集成
- 基础交易流程
- 风控机制

---

## 📚 相关文档

- 技术可行性评估: `/home/xx/perfect21/investment/trading-system/docs/FEASIBILITY_ASSESSMENT.md`
- 架构设计: `/home/xx/perfect21/investment/trading-system/docs/ARCHITECTURE_V2.md`
- Cecelia 定义: `/home/xx/perfect21/cecelia/core/DEFINITION.md`

---

**Created by**: Claude (Opus 4.6)
**For**: Perfect21 Trading System
**Managed by**: Cecelia 管家系统
