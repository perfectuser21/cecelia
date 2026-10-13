## CI 固定历史审计（2026-10-13）

### 根本原因

合并新增 import 后，既有 handler 守卫的白名单行号落后一行。DoD 动态作业使用 checkout 默认浅历史，但固定基线审计需要旧 commit。

### 下次预防

- [x] 源码定位清单变更后运行守卫，保留禁止新增名单及陈旧清单检查。
- [x] 从实际 workflow 读取 checkout 深度，真实克隆验证固定旧 blob 可读，并继续运行正式基线审计。

主线单 scope Implementation impact 的历史 UNKNOWN 保留原事实；本修复未将准入证据冒充完整发布证明。
