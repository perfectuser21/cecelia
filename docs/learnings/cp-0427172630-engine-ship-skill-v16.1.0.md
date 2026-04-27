## engine-ship SKILL.md v16.1.0 — callback-brain-task 自动回写（2026-04-27）

### 根本原因

engine-ship §2 只 fire-learnings-event，未调用 callback-brain-task.sh，
导致 Brain task status 不自动变 completed，违反 CLAUDE.md §8 零人为交互点原则。

### 下次预防

- [ ] engine-ship §2 新增 fire 事件后，同步确认是否需要对应的 callback 步骤
- [ ] CLAUDE.md §8 要求的回写动作必须在 SKILL.md 中有显式步骤，不依赖人工提醒
