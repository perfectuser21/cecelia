# Learning: SelfDrive 输出类型扩展

## 背景

扩展 self-drive.js 让 SelfDrive 不仅能创建 dev 任务，还能调整 Project 优先级、暂停/激活 KR、更新 Roadmap 阶段。

### 根本原因

SelfDrive 原有设计只支持单一输出类型（create_task），无法对已有 OKR 体系进行调整操作。需要扩展 LLM 输出格式和 action 处理逻辑。

### 下次预防

- [ ] 扩展 LLM 输出格式时，同步更新 prompt 中的示例和约束说明
- [ ] 涉及数据库写操作的新功能，确保有审计日志记录（decision_log）
- [ ] 自动化 action 需要有安全上限，防止单次执行大幅变动

## 关键决策

1. 调整类 action 每次最多 2 个（MAX_ADJUSTMENT_ACTIONS = 2），防止 LLM 一次性做太多变动
2. 所有调整操作写入 decision_log 表，保持审计追踪
3. update_roadmap 复用 projects.current_phase 字段，不新增表
4. 不允许删除 KR/Project，只能暂停（安全保护）
