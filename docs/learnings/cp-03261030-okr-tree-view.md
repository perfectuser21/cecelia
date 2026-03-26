## OKR 全树视图 — 7层嵌套 API 扩展（2026-03-26）

### 根本原因
现有 /tree 端点只查询了前3层表（visions, objectives, key_results），缺少对 okr_projects、okr_scopes、okr_initiatives、tasks 四张表的级联查询。前端也缺少展示完整层级的树形视图页面。

### 下次预防
- [ ] 扩展嵌套 API 时，确保 spec review 中验证测试能区分扩展前后的行为差异（避免伪测试）
- [ ] 前端 expandAll 状态需要通过 props 或 key 传递给子组件，不能只在父组件维护状态而忘记下传
- [ ] DoD 条目必须包含至少 1 个 [BEHAVIOR] 标签，CI check-dod-mapping 强制检查此规则
