# Learning: War Room 横向多列布局

### 根本原因

GTD 路由使用 `isFullHeightRoute`，外层容器是 `flex-1 min-h-0 overflow-hidden`，
页面必须自己用 `h-full` 撑满高度才能正常显示。

原 War Room 根元素用 `max-w-4xl space-y-6`，没有 `h-full`，导致容器高度不确定，
外层 `overflow-hidden` 截断了内容，造成"上下刷不动"的现象。

### 解决方案

- 根元素改为 `h-full flex-col overflow-hidden`，撑满父容器
- 顶部 Vision/页头区域 `shrink-0`，固定高度
- 下方内容区 `flex-1 min-h-0 grid grid-cols-3`，三列均分
- 每列 `overflow-y-auto`，各自独立滚动

### 下次预防

- [ ] GTD 路由下的页面属于 `isFullHeightRoute`，必须自己管理 `h-full`，不能依赖外层滚动
- [ ] 宽屏 dashboard 首选 `grid-cols-N` 而非 `max-w-xxx`，后者在宽屏浪费空间
- [ ] 各列 sticky header 需要 `sticky top-0 bg-[背景色]`，否则滚动时标题消失
