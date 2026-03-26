# Learning: OKR 全树视图

## 变更摘要
扩展 GET /api/brain/okr/tree API 从 3 层（Vision→Objective→KR）到完整 7 层嵌套（+Project→Scope→Initiative→Task），新增前端 /okr/tree 树组件。

### 根本原因
现有 /tree 端点只查询了前3层表（visions, objectives, key_results），缺少对 okr_projects、okr_scopes、okr_initiatives、tasks 四张表的级联查询。前端也缺少完整的树形视图页面。

### 下次预防
- [ ] 扩展嵌套 API 时，确保 spec review 中验证测试能区分扩展前后的行为差异
- [ ] 前端 expandAll 状态需要通过 props 或 key 传递给子组件，不能只在父组件维护状态
- [ ] DoD 条目必须包含至少 1 个 [BEHAVIOR] 标签，CI check-dod-mapping 强制检查

## 技术细节
- 后端使用嵌套 Promise.all 逐层查询，OKR 数据量有限，N+1 查询可接受
- 前端使用 key={expandAll ? 'expanded' : 'collapsed'} 强制 remount 实现全局展开/收起
- Tasks 层只 SELECT 必要字段（id, title, status, priority, created_at, completed_at）减少数据传输
