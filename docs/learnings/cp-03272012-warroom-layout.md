# Learning: War Room 横向多列布局

## 根本原因

War Room 使用 `max-w-4xl space-y-6` 竖向单列布局，在宽屏浪费空间，且外层容器 `flex-1 min-h-0 overflow-hidden` 与内层 `p-6` 冲突，导致页面无法正常滚动（"上下刷不动"）。

## 解决方案

- 根元素改为 `h-full flex-col overflow-hidden`，撑满父容器
- 顶部 Vision/页头区域 `shrink-0`，固定高度
- 下方内容区 `flex-1 min-h-0 grid grid-cols-3`，三列均分
- 每列 `overflow-y-auto`，各自独立滚动

## 下次预防

- [ ] GTD 路由下的页面属于 `isFullHeightRoute`，必须自己管理 `h-full`，不能依赖外层滚动
- [ ] 宽屏 dashboard 首选 `grid-cols-N` 而非 `max-w-xxx`，后者在宽屏浪费空间
- [ ] 各列 sticky header 需要 `sticky top-0 bg-[背景色]`，否则滚动时标题消失
