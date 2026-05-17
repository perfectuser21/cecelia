# Learning: Dashboard 集成测试覆盖（Round 2）

**分支**: cp-04100122-ceaea7ee-bf2d-4015-9f75-6e4b20
**日期**: 2026-04-10
**任务**: [SelfDrive] Dashboard 3大模块 bug修复 + 集成测试

## 背景
PR #2171 已修复 3 个 bug 并为 ViralAnalysisPage 添加 8 个测试（55→63）。本次（Round 2）补足 4 个无覆盖页面的集成测试。

## 新增测试文件
- `AccountUsagePage.test.tsx` — 9 个用例（渲染/Claude账号/Codex账号/过期标记/错误/刷新）
- `TaskTypeConfigPage.test.tsx` — 6 个用例（渲染/分类A-D/展开/API调用）
- `ReportsListPage.test.tsx` — 7 个用例（渲染/列表/空状态/API失败/生成）
- `CollectionDashboardPage.test.tsx` — 6 个用例（渲染/平台卡片/错误/健康率）

### 根本原因
首次分发时已处理 3 大 bug，但 4 个页面没有任何测试仍是覆盖盲区，不满足 KR5"完整演示 20 分钟无阻断 bug"的持续验证要求。

### 下次预防
- [ ] 新增页面时同步要求写测试（不单独留 `*.tsx` 无对应 `*.test.tsx`）
- [ ] `加载中` 占位文本断言需用 `mockReturnValueOnce(new Promise(() => {}))` 确保看到加载态，而不是在 `act` 内 render

## 模式记录
- 所有测试统一 mock `react-router-dom`：`useNavigate: () => vi.fn()`
- API mock 放 `beforeEach`：`global.fetch = vi.fn().mockResolvedValue(...)`
- 加载失败测试用 `mockRejectedValueOnce(new Error(...))`
- Codex 过期标记检测：直接找 `EXPIRED` 文字
