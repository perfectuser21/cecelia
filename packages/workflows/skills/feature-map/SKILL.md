---
name: feature-map
version: 1.0.0
description: Feature Map 可视化设计规范 - 展示系统关键功能的交互式地图
trigger: feature map、功能地图、架构可视化、系统地图
---

# Feature Map 可视化设计规范

展示系统关键功能的交互式地图，基于 Brain 架构图实战优化总结的最佳实践。

## 核心理念

**平衡视觉清晰度、信息密度和交互体验。**

- 初始视图要完整展示所有节点
- 详情面板打开时自动调整视图，避免遮挡
- 配色柔和，不抢眼
- 字体精致，信息密度适中

## 布局参数（Layout Parameters）

### 侧边详情面板

```css
/* 左侧详情面板 */
#details {
  position: fixed;
  top: 0;
  left: -285px;        /* 隐藏时的位置 */
  width: 275px;        /* 面板宽度（经过多次调整的最佳值）*/
  height: 100vh;
  background: rgba(30, 41, 59, 0.98);
  backdrop-filter: blur(10px);
  border-right: 2px solid rgba(59, 130, 246, 0.4);
  box-shadow: 4px 0 20px rgba(0, 0, 0, 0.5);
  z-index: 999;
  transition: left 0.3s ease;
  overflow-y: auto;
  font-size: 0.75rem;  /* 基础字体大小 */
}

#details.show {
  left: 0;
}
```

### 右侧控制面板

```css
/* 折叠时不完全隐藏，保留标题 */
.path-controls.collapsed,
.stats-panel.collapsed {
  width: auto;
  max-width: 120px;  /* 只显示标题，不占太多空间 */
}
```

### 主画布响应式调整

```css
#main {
  width: 100vw;
  height: 100vh;
  overflow: visible;  /* 关键！防止节点被裁剪 */
}

#main.shifted {
  margin-left: 275px;  /* 与详情面板宽度一致 */
  transform: scale(1); /* 不缩放，保持清晰度 */
  transform-origin: 0% center; /* 从左边缘缩放 */
}

body {
  overflow: visible;   /* 关键！允许内容超出视口 */
}
```

## 字体大小层级（Typography Scale）

```css
/* 基础字体 */
#details { font-size: 0.75rem; }

/* 标题层级 */
#details-header h2 { font-size: 0.95rem; }  /* 面板标题 */
#details-body h2   { font-size: 1rem; }     /* 内容大标题 */

/* 标签和辅助文字 */
.detail-label { font-size: 0.75rem; }       /* 字段标签 */
.detail-value { font-size: inherit; }       /* 内容文字，继承基础字体 */
```

**原则**：
- 层级清晰：标题 > 正文 > 标签
- 差距适中：不超过 0.2-0.3rem
- 整体偏小：信息密度优先

## 视图参数（View Parameters）

### ECharts 配置

```javascript
// 初始状态（详情面板关闭）
{
  zoom: 1.05,
  center: ['60%', '45%']  // 稍微偏右，平衡视觉中心
}

// 详情面板打开状态
{
  zoom: 0.85,             // 缩小让出空间
  center: ['75%', '45%']  // 明显右移，避免左侧遮挡
}
```

**关键决策**：
- center 参数：数值越大 = 图形越往左移（反直觉！）
- zoom 差值：1.05 vs 0.85 = 约 20% 的大小差异
- center 差值：60% vs 75% = 15% 的位置偏移

### 智能重置函数

```javascript
window.resetView = function() {
  if (window.myChart) {
    const main = document.getElementById('main');
    const isShifted = main.classList.contains('shifted');

    // 根据当前状态自动选择最佳参数
    window.myChart.setOption({
      series: [{
        zoom: isShifted ? 0.85 : 1.05,
        center: isShifted ? ['75%', '45%'] : ['60%', '45%']
      }]
    });
  }
};
```

## 配色方案（Color Palette）

### 柔和按钮配色

```css
/* 默认状态：极低透明度 */
.btn-a {
  border-color: rgba(59, 130, 246, 0.1);   /* 边框几乎透明 */
  color: rgba(59, 130, 246, 0.25);         /* 文字半透明 */
}

/* 悬停/激活：适度提升 */
.btn-a:hover, .btn-a.active {
  border-color: rgba(59, 130, 246, 0.2);
  color: rgba(59, 130, 246, 0.45);
}
```

**原则**：
- 默认状态：0.1 / 0.25（边框/文字）
- 激活状态：0.2 / 0.45
- 避免过高透明度（> 0.6），会显得"艳"

### 色彩角色定义

| 颜色 | RGB | 用途 | 透明度范围 |
|------|-----|------|-----------|
| 蓝色 | 59, 130, 246 | 简单任务、默认 | 0.1 - 0.45 |
| 紫色 | 168, 85, 247 | 复杂任务、LLM | 0.1 - 0.45 |
| 橙色 | 245, 158, 11 | 自主循环、警告 | 0.1 - 0.45 |
| 红色 | 239, 68, 68 | 保护层、错误 | 0.1 - 0.45 |

## 交互功能（Interactive Features）

### 必备功能

```javascript
// 1. 放大（每次 1.2 倍）
window.zoomIn = function() {
  if (window.myChart) {
    const currentOpt = window.myChart.getOption();
    const currentZoom = currentOpt.series[0].zoom || 1;
    window.myChart.setOption({
      series: [{ zoom: currentZoom * 1.2 }]
    });
  }
};

// 2. 缩小（每次 0.8 倍）
window.zoomOut = function() {
  if (window.myChart) {
    const currentOpt = window.myChart.getOption();
    const currentZoom = currentOpt.series[0].zoom || 1;
    window.myChart.setOption({
      series: [{ zoom: currentZoom * 0.8 }]
    });
  }
};

// 3. 截图导出（2 倍分辨率）
window.exportImage = function() {
  if (window.myChart) {
    const url = window.myChart.getDataURL({
      type: 'png',
      pixelRatio: 2,              // 高清截图
      backgroundColor: '#0f172a'  // 深色背景
    });
    const link = document.createElement('a');
    link.download = 'graph-' + new Date().getTime() + '.png';
    link.href = url;
    link.click();
  }
};
```

### 顶部控制栏

```html
<div class="title">
  <h1 style="position: absolute; left: 20px;">图表标题</h1>
  <div style="display: flex; gap: 0.5rem;">
    <button onclick="zoomIn()">放大</button>
    <button onclick="zoomOut()">缩小</button>
    <button onclick="resetView()">重置视图</button>
    <button onclick="exportImage()">截图</button>
  </div>
</div>
```

**按钮样式**：
```css
.reset-view-btn {
  padding: 0.5rem 1rem;
  background: rgba(59, 130, 246, 0.2);
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: 6px;
  color: #60a5fa;
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.2s;
  white-space: nowrap;
}
```

## 关键技巧（Critical Tricks）

### 1. 避免 setTimeout 时序问题

❌ **错误做法**：
```javascript
setTimeout(() => {
  if (window.myChart) {
    window.myChart.setOption({ series: [{ zoom: 0.85, center: ['75%', '45%'] }] });
    window.myChart.resize();
  }
}, 300);
```

✅ **正确做法**：
```javascript
// 立即设置 zoom/center（避免时序冲突）
if (window.myChart) {
  window.myChart.setOption({
    series: [{ zoom: 0.85, center: ['75%', '45%'] }]
  });
}

// 延迟调用 resize（等待 CSS 动画完成）
setTimeout(() => {
  if (window.myChart) window.myChart.resize();
}, 300);
```

**原因**：多次快速点击时，多个 setTimeout 会同时运行，导致位置"跑偏"。

### 2. 防止节点被裁剪

```css
body {
  overflow: visible;  /* 不是 hidden！ */
}

#main {
  overflow: visible;  /* 允许内容超出容器 */
}
```

**错误现象**：如果设置 `overflow: hidden`，拖动节点到边界时会被裁剪消失。

### 3. ECharts center 参数反直觉

```javascript
center: ['20%', '45%']  // 图形在左侧（容器中心点在 20% 位置）
center: ['80%', '45%']  // 图形在右侧（容器中心点在 80% 位置）
```

**理解**：center 不是"图形的位置"，而是"视口中心对准图形的哪个位置"。
- 小值（如 20%）→ 视口左侧对准图形中心 → 图形偏左
- 大值（如 80%）→ 视口右侧对准图形中心 → 图形偏右

### 4. 面板折叠不要完全隐藏

❌ **错误做法**：
```css
.panel.collapsed {
  display: none;  /* 完全消失，用户不知道还有这个功能 */
}
```

✅ **正确做法**：
```css
.panel.collapsed {
  width: auto;
  max-width: 120px;  /* 只显示标题，保持存在感 */
}

.panel.collapsed .panel-body {
  display: none;     /* 只隐藏内容 */
}
```

## 完整工作流程（Complete Workflow）

### 打开详情面板

```javascript
// 1. 先设置视图（避免时序问题）
if (window.myChart) {
  window.myChart.setOption({
    series: [{
      zoom: 0.85,
      center: ['75%', '45%']
    }]
  });
}

// 2. 显示面板
details.classList.add('show');
document.getElementById('main').classList.add('shifted');

// 3. 折叠右侧面板
const pathControls = document.getElementById('pathControls');
const statsPanel = document.getElementById('statsPanel');
if (pathControls) pathControls.classList.add('collapsed');
if (statsPanel) statsPanel.classList.add('collapsed');

// 4. 延迟调整大小
setTimeout(() => {
  if (window.myChart) window.myChart.resize();
}, 300);
```

### 关闭详情面板

```javascript
// 1. 隐藏面板
panel.classList.remove('show');
main.classList.remove('shifted');

// 2. 展开右侧面板
pathControls.classList.remove('collapsed');
statsPanel.classList.remove('collapsed');

// 3. 恢复视图
setTimeout(() => {
  if (window.myChart) {
    window.myChart.setOption({
      series: [{
        zoom: 1.05,
        center: ['60%', '45%']
      }]
    });
    window.myChart.resize();
  }
}, 300);
```

## 数值速查表（Quick Reference）

| 参数 | 初始值 | 面板打开值 | 说明 |
|------|--------|-----------|------|
| **zoom** | 1.05 | 0.85 | 差值 ~20% |
| **center X** | 60% | 75% | 差值 15% |
| **center Y** | 45% | 45% | 不变 |
| **面板宽度** | - | 275px | 经验值 |
| **margin-left** | 0 | 275px | 与面板宽度一致 |
| **基础字体** | - | 0.75rem | - |
| **h2 标题** | - | 0.95-1rem | - |
| **按钮透明度** | 0.1/0.25 | 0.2/0.45 | 边框/文字 |

## 常见问题（Troubleshooting）

### Q: 第二次点击位置"跑偏"？
A: 检查是否将 setOption 放在了 setTimeout 里，应该立即执行。

### Q: 节点拖到右边消失？
A: 检查 overflow 是否设置为 hidden，应该是 visible。

### Q: 颜色看起来太"艳"？
A: 降低透明度到 0.1-0.45 范围，不要超过 0.6。

### Q: 面板打开后图形偏右？
A: 增大 center X 值（反直觉！），比如从 60% 增加到 75%。

### Q: 字体太大，信息密度不够？
A: 基础字体设为 0.75rem，标题不超过 1rem。

## 扩展应用

这套参数和模式适用于：
- 架构图可视化
- 依赖关系图
- 组织架构图
- 流程图
- 知识图谱

**核心不变**：侧边面板 + 响应式视图调整 + 柔和配色 + 精致字体

## 版本记录

- v1.0.0 (2026-02-13): 初始版本，基于 Brain 架构图实战优化
