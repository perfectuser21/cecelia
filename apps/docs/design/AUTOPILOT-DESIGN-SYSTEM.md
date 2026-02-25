---
id: autopilot-design-system
version: 1.0.0
created: 2026-01-30
updated: 2026-01-30
changelog:
  - 1.0.0: 初始版本 - 悦升云端设计规范
---

# 悦升云端（Autopilot）设计系统

悦升云端 UI 设计规范，用于 Pencil 设计和前端开发时保持视觉一致性。

---

## 品牌色

### 侧边栏 - 核心识别

```css
/* 固定不变，品牌识别核心 */
background: linear-gradient(180deg, #1e3a8a 0%, #1e2a5e 100%);
```

### 主色系 - 企业蓝

| Token | 色值 | 用途 |
|-------|------|------|
| `--primary` | `#3B82F6` | 主按钮、激活态、强调 |
| `--primary-dark` | `#1D4ED8` | 渐变终点、hover |
| `--primary-light` | `#60A5FA` | 渐变起点（浅）、次要 |
| `--primary-lighter` | `#93C5FD` | 非激活图标、辅助文字 |

### 语义色

| Token | 色值 | 用途 |
|-------|------|------|
| `--success` | `#16A34A` | 成功、在线、增长 |
| `--warning` | `#D97706` | 警告、待处理 |
| `--error` | `#DC2626` | 错误、离线 |

### 中性色

| Token | 浅色模式 | 深色模式 |
|-------|----------|----------|
| `--bg` | `#F8FAFC` | `#0F172A` |
| `--card` | `#FFFFFF` | `#1E293B` |
| `--border` | `#F1F5F9` | `#334155` |
| `--text-primary` | `#1E293B` | `#F1F5F9` |
| `--text-secondary` | `#64748B` | `#94A3B8` |

---

## 图标规范

### 核心规则

**统一风格：渐变背景框 + 白色图标**

```
✅ 正确：蓝色渐变背景框 + 白色图标
✅ 正确：深浅蓝色交替增加层次
❌ 错误：使用平台品牌色（小红书红、抖音彩）
❌ 错误：多彩混搭（紫、粉、青、绿）
❌ 错误：纯色图标无背景框（快捷操作等区域）
```

### 图标背景框样式

```javascript
// 深蓝渐变（主）
{
  "fill": {
    "type": "gradient",
    "gradientType": "linear",
    "rotation": 135,
    "colors": [
      {"color": "#3B82F6", "position": 0},
      {"color": "#1D4ED8", "position": 1}
    ]
  },
  "cornerRadius": 10,
  "effects": [{"type": "shadow", "color": "#3B82F630", "blur": 12, "offsetY": 4}]
}

// 浅蓝渐变（交替）
{
  "fill": {
    "type": "gradient",
    "gradientType": "linear",
    "rotation": 135,
    "colors": [
      {"color": "#60A5FA", "position": 0},
      {"color": "#3B82F6", "position": 1}
    ]
  },
  "cornerRadius": 10,
  "effects": [{"type": "shadow", "color": "#3B82F630", "blur": 12, "offsetY": 4}]
}
```

### 尺寸规范

| 场景 | 图标尺寸 | 背景框尺寸 | 圆角 |
|------|----------|------------|------|
| 指标卡片 | 20×20 | 40×40 | 10 |
| 功能模块 | 28×28 | 40×40 | 12 |
| 快捷操作 | 20×20 | 40×40 | 10 |
| 内容卡片 | 18×18 | 36×36 | 8 |
| 部门/账号头像 | 18×18 文字 | 36-48 | 50% |
| 导航菜单 | 18-20 | 无背景框 | - |

### 图标字体

```javascript
{
  "iconFontFamily": "lucide",
  "fill": "#FFFFFF"  // 白色图标在渐变背景上
}
```

---

## 卡片规范

### 浅色模式

```javascript
{
  "fill": "#FFFFFF",
  "cornerRadius": 16,
  "effects": [{"type": "shadow", "color": "#0000000A", "blur": 20, "offsetY": 8}],
  "stroke": "#F1F5F9",
  "strokeThickness": 1,
  "padding": 20
}
```

### 深色模式

```javascript
{
  "fill": "#1E293B",
  "cornerRadius": 16,
  "effects": [{"type": "shadow", "color": "#0000000A", "blur": 20, "offsetY": 8}],
  "stroke": "#334155",
  "strokeThickness": 1,
  "padding": 20
}
```

---

## 按钮规范

### 主按钮

```javascript
{
  "fill": {
    "type": "gradient",
    "gradientType": "linear",
    "rotation": 135,
    "colors": [
      {"color": "#3B82F6", "position": 0},
      {"color": "#2563EB", "position": 1}
    ]
  },
  "cornerRadius": 8,
  "height": 40,
  "padding": [0, 16],
  "effects": [{"type": "shadow", "color": "#3B82F630", "blur": 12, "offsetY": 4}],
  "textColor": "#FFFFFF",
  "fontWeight": "500"
}
```

### 次要按钮

```javascript
{
  "fill": "#FFFFFF",  // 深色模式: "#1E293B"
  "cornerRadius": 8,
  "height": 40,
  "padding": [0, 16],
  "stroke": "#E2E8F0",  // 深色模式: "#334155"
  "strokeThickness": 1,
  "textColor": "#64748B"
}
```

### 激活态卡片/按钮

```javascript
// 激活态背景
{
  "fill": {
    "type": "gradient",
    "gradientType": "linear",
    "rotation": 135,
    "colors": [
      {"color": "#3B82F6", "position": 0},
      {"color": "#2563EB", "position": 1}
    ]
  },
  // 图标背景框用半透明白色
  "iconBoxFill": "#FFFFFF30",
  "textColor": "#FFFFFF"
}
```

---

## 状态标签

### 成功状态

```javascript
{
  "fill": {"type": "gradient", "rotation": 90, "colors": [
    {"color": "#DCFCE7", "position": 0},
    {"color": "#D1FAE5", "position": 1}
  ]},
  "cornerRadius": 6,
  "height": 24,
  "padding": [0, 8],
  "textColor": "#16A34A",
  "fontSize": 11,
  "fontWeight": "500"
}
```

### 警告状态

```javascript
{
  "fill": {"type": "gradient", "rotation": 90, "colors": [
    {"color": "#FEF3C7", "position": 0},
    {"color": "#FDE68A", "position": 1}
  ]},
  "cornerRadius": 6,
  "textColor": "#D97706"
}
```

### 错误状态

```javascript
{
  "fill": {"type": "gradient", "rotation": 90, "colors": [
    {"color": "#FEE2E2", "position": 0},
    {"color": "#FECACA", "position": 1}
  ]},
  "cornerRadius": 6,
  "textColor": "#DC2626"
}
```

---

## 导航菜单

### 侧边栏导航

```javascript
// 激活态
{
  "fill": "#FFFFFF20",
  "cornerRadius": 12,
  "height": 44,
  "padding": [0, 12],
  "gap": 12,
  "indicator": {"fill": "#0EA5E9", "width": 4, "cornerRadius": 2},
  "iconColor": "#FFFFFF",
  "textColor": "#FFFFFF"
}

// 非激活态
{
  "fill": "transparent",
  "iconColor": "#93C5FD",
  "textColor": "#93C5FD"
}
```

### Tab 导航

```javascript
// 主 Tab 激活态
{
  "fill": {
    "type": "gradient",
    "rotation": 135,
    "colors": [{"color": "#3B82F6"}, {"color": "#2563EB"}]
  },
  "cornerRadius": [8, 8, 0, 0],
  "iconColor": "#FFFFFF",
  "textColor": "#FFFFFF"
}

// 子 Tab 激活态
{
  "fill": "#EFF6FF",  // 深色模式: "#1E3A5F"
  "cornerRadius": 8,
  "iconColor": "#3B82F6",
  "textColor": "#3B82F6"
}
```

---

## 字体规范

| 场景 | 字体 | 字号 | 字重 |
|------|------|------|------|
| 页面标题 | Inter | 24-28 | 600 |
| 卡片标题 | Inter | 18 | 600 |
| 数据值 | Inter | 32 | 700 |
| 正文 | Inter | 14-15 | 400-500 |
| 辅助文字 | Inter | 12-13 | 400 |
| 品牌名 | PingFang SC | 18 | 600 |

---

## 深色模式规则

1. **侧边栏不变** - 始终保持企业蓝渐变 `#1e3a8a → #1e2a5e`
2. **内容区变暗** - 背景 `#0F172A`，卡片 `#1E293B`
3. **文字反色** - 主文字 `#F1F5F9`，辅助 `#94A3B8`
4. **图标不变** - 渐变图标在深色背景更突出
5. **边框加深** - 使用 `#334155` 代替 `#F1F5F9`

---

## Emoji 规则

- ✅ **仅在问候语中使用** emoji（如 "下午好，运营团队 ✨"）
- ❌ **其他位置禁止** emoji
- 使用 Lucide 图标代替表情符号

---

## 设计检查清单

使用此清单验证设计一致性：

- [ ] 侧边栏使用正确的企业蓝渐变？
- [ ] 所有图标都是"渐变背景框 + 白色图标"样式？
- [ ] 图标颜色是蓝色系（深浅交替）？
- [ ] 没有使用平台品牌色或多彩混搭？
- [ ] 卡片有精致阴影和边框？
- [ ] 按钮使用渐变 + 阴影？
- [ ] 深色模式侧边栏保持蓝色？
- [ ] 只在问候语中使用 emoji？

---

## 参考设计

设计稿位置：`pencil-new.pen`

包含页面：
1. 工作台（浅色）
2. 工作台（深色）
3. 新媒体运营
4. AI 员工
5. 账号管理
