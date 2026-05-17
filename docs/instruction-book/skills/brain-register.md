---
id: instruction-brain-register
version: 1.0.0
created: 2026-03-10
updated: 2026-03-10
authority: USER_FACING
changelog:
  - 1.0.0: 初始版本
---

# /brain-register — Brain 注册向导

## What it is

向 Brain 注册新实体的一站式向导。
当需要让 Brain 认识一个新的 skill、新的 task_type、或新的 LLM agent 时使用。

## Trigger

用户说以下内容时触发：
- "让 Brain 能派发 XXX 任务"
- "注册新 skill"
- "新增 task_type"
- "Brain 报 X not in AGENTS"

## How to use

```bash
/brain-register
```

向导会引导完成以下注册：

| 注册类型 | 需要修改的文件 |
|---------|--------------|
| 新 task_type | `executor.js` + `task-router.js` + `DEFINITION.md` + `regression-contract.yaml` + `VALID_TASK_TYPES` |
| 新 LLM agent | `model-registry.js` + 相关配置 |
| 新 skill 路由 | `task-router.js` 的 LOCATION_MAP |

## Output

- 完整的多文件修改清单
- 防止漏改导致 CI 失败的检查指引

## Added in

PR #767（2026-03-10，随 arch-review 注册一同建立）
