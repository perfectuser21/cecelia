---
id: plan-how-to-use
version: 1.0.0
created: 2026-02-17
updated: 2026-02-17
changelog:
  - 1.0.0: 初始版本
---

# Cecelia 系统使用手册（一页参考卡）

## 每天工作的入口

### 1. 说一件想做的事 -- 自动识别

直接说，系统自动识别层级 + 查已有能力：

```
"今天想把 XXX 做好" --> [Plan 识别] 输出层级 + 已有能力 + 下一步
```

### 2. 层级 --> 行动

| 你说的 | 识别层级 | 行动 |
|--------|---------|------|
| "这个季度要..." | Global OKR | 讨论 --> 存入 DB |
| "这个月要..." | Area OKR | 讨论 --> 存入 DB |
| "XX 要从 A 提升到 B" | KR | 自动触发秋米拆解 |
| "今天想做 XXX" | Initiative | 直接 /dev |
| "修复这个 bug" | Task | 直接 /dev |

### 3. 开发完了 --> 部署（零停机）

```bash
cd /home/xx/perfect21/cecelia/core
bash scripts/rolling-update.sh
```

### 4. 查系统已有能力

```bash
curl -s http://localhost:5221/api/brain/capabilities | python3 -c "
import sys,json
d=json.load(sys.stdin)
for c in d.get('capabilities',[]): print(f\"{c['id']} (stage={c['current_stage']}) -- {c['name']}\")
"
```

### 5. 查任务队列

```bash
curl -s "http://localhost:5221/api/brain/tasks?status=queued" | python3 -c "
import sys,json
d=json.load(sys.stdin)
for t in d[:5]: print(f\"{t['task_type']} | {t['title'][:60]}\")
"
```

## 关键文件位置

| 东西 | 位置 |
|------|------|
| /plan skill | ~/.claude/skills/plan/SKILL.md |
| /dev skill | ~/.claude/skills/dev/SKILL.md |
| /okr skill | ~/.claude/skills/okr/SKILL.md |
| 部署脚本 | ~/perfect21/cecelia/core/scripts/rolling-update.sh |
| Capability 文档 | ~/perfect21/cecelia/core/docs/CAPABILITY_*.md |
| Brain API | http://localhost:5221/api/brain/* |

## 完整流程图

```
用户说话
    |
[/plan 识别层级 + 查 capability]
    |
    +-- OKR 层 --> 讨论 --> 存 DB --> OKR Tick 自动触发秋米拆解
    |
    +-- Initiative/Task 层 --> /dev --> PRD --> DoD --> Code --> PR --> CI --> Merge
    |
    +-- 部署 --> bash scripts/rolling-update.sh（零停机蓝绿部署）
```
