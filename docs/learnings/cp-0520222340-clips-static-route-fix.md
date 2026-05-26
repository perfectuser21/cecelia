# Learning: /clips 静态路由修复

### 根本原因
DynamicRouter 所有路由依赖 coreConfig 加载成功。若 buildCoreConfig() 抛出异常，coreConfig=null，allRoutes=[]，catch-all 将所有路径重定向到 /。功能页（clips、PRD、harness）不属于配置驱动体系，应注册为静态路由。

### 下次预防
- [ ] 新增功能页时，先判断是否需要动态配置：如果是"总是可访问"的功能页，直接加到 App.tsx 静态路由，不进 navigation.config/system-hub。
- [ ] 参考模式：TaskPrdPage/HarnessDetailPage/ContentClipsPage 均为静态路由。
