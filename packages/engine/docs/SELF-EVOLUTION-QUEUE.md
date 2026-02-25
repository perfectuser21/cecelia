# Self-Evolution Queue

待处理的自我进化任务队列。

## 队列格式

```yaml
---
pending:
  - id: SE-001
    created: 2026-01-27T08:00:00+08:00
    source: post-pr-checklist.sh
    type: prd-dod-residue
    description: "develop 分支存在 PRD/DoD 残留"
    priority: P3
    auto_fix: true

  - id: SE-002
    created: 2026-01-27T09:00:00+08:00
    source: post-pr-checklist.sh
    type: version-drift
    description: "派生视图版本不同步"
    priority: P2
    auto_fix: false

in_progress: []
completed: []
---
```

## 字段说明

| 字段 | 必填 | 说明 |
|------|------|------|
| id | ✅ | 唯一标识，格式 SE-NNN |
| created | ✅ | 创建时间（ISO 8601） |
| source | ✅ | 来源脚本/工具 |
| type | ✅ | 问题类型 |
| description | ✅ | 问题描述 |
| priority | ✅ | 优先级 P0-P3 |
| auto_fix | ✅ | 是否可自动修复 |

## 问题类型

| Type | 说明 | auto_fix |
|------|------|----------|
| prd-dod-residue | PRD/DoD 残留 | true |
| version-drift | 版本不同步 | false |
| temp-file-residue | 临时文件残留 | true |
| unpushed-commits | 未推送的 commit | false |

## 处理流程

### 自动处理（auto_fix: true）

定时任务或 CI 自动执行：

```bash
bash scripts/self-evolution-worker.sh
```

### 手动处理（auto_fix: false）

1. 从队列中选择任务
2. 创建 PRD（基于任务描述）
3. 运行 `/dev` 完成修复
4. 将任务标记为 completed

## 当前队列

_空队列 - 暂无待处理任务_
