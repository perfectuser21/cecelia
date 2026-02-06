# QA Decision - 仪表盘 UI/UX 设计

## Decision
Decision: NO_RCI
Priority: P1
RepoType: Business

## Tests

### 平台维度
- dod_item: "显示至少 5 个平台的发布统计数据"
  method: manual
  location: manual:DevTools Network验证/api/stats/platform调用成功(200) → 记录API返回数据 → 验证页面显示卡片数量>=5 → 对比API数据与页面显示一致性（平台名称、发布数量、成功率）

- dod_item: "每个平台显示成功率百分比"
  method: manual
  location: manual:记录API返回的success/total数值 → 验证页面显示百分比=(success/total*100).toFixed(1)%

- dod_item: "平台卡片按成功率或活跃度排序"
  method: manual
  location: manual:记录每个平台实际成功率数值 → 验证卡片从上到下按成功率降序排列

### 时间维度
- dod_item: "支持切换 24h/7d/30d 三种时间范围"
  method: manual
  location: manual:点击时间范围切换按钮，DevTools Network验证API请求参数range=24h|7d|30d，图表数据更新

- dod_item: "显示时间序列折线图或柱状图"
  method: manual
  location: manual:记录API返回的时间序列数据点[{timestamp, value}] → 验证图表X轴时间标签与timestamp一致 → 验证图表Y轴数值与value一致 → 逐点对比验证

- dod_item: "图表交互：悬停显示详细数据点"
  method: manual
  location: manual:鼠标悬停在图表上，验证 tooltip 显示具体数值和时间标签

### 成功率维度
- dod_item: "显示成功/失败/进行中任务的饼图或环形图"
  method: manual
  location: manual:DevTools Network验证/api/stats/success-rate调用成功(200) → 记录API返回{success, failed, in_progress}数量 → 验证图表三个扇区面积比例与数量比例一致

- dod_item: "显示具体数量和百分比"
  method: manual
  location: manual:验证显示success/failed/in_progress具体数量 → 计算total=success+failed+in_progress → 验证三个百分比=(数量/total*100).toFixed(1)% → 验证总和=100%

### 响应式和体验
- dod_item: "桌面端布局合理，信息密度适中"
  method: manual
  location: manual:1920x1080 分辨率下截图验证

- dod_item: "移动端布局自适应，卡片堆叠"
  method: manual
  location: manual:375x667 分辨率下截图验证

- dod_item: "数据自动刷新，默认间隔 30 秒"
  method: manual
  location: manual:记录初始数据 → 悬停图表查看tooltip → 等待30秒 → DevTools Network观察3个API重新请求 → 验证数据更新 → 验证tooltip未消失或跳动

- dod_item: "提供手动刷新按钮"
  method: manual
  location: manual:点击刷新按钮验证数据立即更新

- dod_item: "加载时显示骨架屏或加载动画"
  method: manual
  location: manual:首次加载页面观察加载状态

- dod_item: "数据为空时显示友好的空状态提示"
  method: manual
  location: manual:清空数据后验证空状态UI

- dod_item: "支持浅色/深色主题切换"
  method: manual
  location: manual:切换主题验证颜色变化

### 技术验收
- dod_item: "路由配置正确，可通过导航访问"
  method: manual
  location: manual:点击侧边栏导航进入仪表盘

- dod_item: "API 端点调用正常"
  method: manual
  location: manual:DevTools Network验证3个API → /api/stats/platform(200, <500ms) → /api/stats/timeline?range=24h|7d|30d(200, <500ms) → /api/stats/success-rate(200, <500ms) → 测试500/404错误处理（mock错误响应，验证友好提示）

- dod_item: "首屏加载时间 < 2 秒"
  method: manual
  location: manual:Chrome Lighthouse（Fast 3G, Mobile）→ LCP<2s → FID<100ms → CLS<0.1 → TTI<3.8s → TBT<300ms

- dod_item: "图表渲染流畅，无卡顿"
  method: manual
  location: manual:观察图表切换和交互流畅度

### 代码质量
- dod_item: "组件结构清晰，职责分离"
  method: auto
  location: contract:audit-pass

- dod_item: "无 console.log 和未使用的 import"
  method: auto
  location: contract:audit-pass

- dod_item: "CSS 样式一致，符合现有设计系统"
  method: manual
  location: manual:代码审查验证样式规范

### 边界情况
- dod_item: "成功率极值处理（0%或100%）"
  method: manual
  location: manual:mock API返回success_rate=0或100 → 验证UI显示正常，无除零错误

- dod_item: "数据异常大值处理"
  method: manual
  location: manual:mock API返回超大数值（如999999次发布）→ 验证数字格式化显示（如999.9K）

- dod_item: "平台数量超预期处理"
  method: manual
  location: manual:mock API返回20个平台 → 验证布局不崩溃，可滚动或分页

## RCI
new: []
update: []

## Reason
这是纯 UI/UX 前端功能，主要涉及新增的仪表盘页面和组件，不影响现有核心业务逻辑和数据处理流程。采用手动测试验证视觉效果、交互体验和响应式布局。不需要新增或更新 RCI 契约测试，因为这是独立的展示层功能。代码质量通过 audit 流程保证。
