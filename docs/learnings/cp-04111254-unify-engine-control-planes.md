## Engine 职责分离重构（2026-04-11）

### 根本原因
Engine 的文档面（steps/*.md 给 Claude 读）和代码面（devloop-check.sh 给 Stop Hook 用）各自独立演进，导致同一操作（PR 合并、cleanup_done 写入、cleanup.sh 调用）在两面都有实现。具体表现：
- devloop-check.sh 条件 6 自动合并 PR，04-ship.md 也有手动 `gh pr merge`
- cleanup_done 有 3 个写入者（04-ship.md / cleanup.sh / devloop-check）
- 03-integrate.md 的 CI 轮询与 devloop-check 条件 4 重复
- 条件 5（恢复路径）调用了 cleanup.sh，但条件 6（正常路径）没有

### 下次预防
- [ ] 新增任何 devloop-check 条件时，同步检查 steps/*.md 是否有重叠操作
- [ ] 维护职责分离原则：文档面只产出（代码/Learning/状态标记），代码面只控制（CI/合并/清理）
- [ ] 条件 5 和条件 6 的合并后行为必须保持一致（都调用 cleanup.sh + _mark_cleanup_done）
