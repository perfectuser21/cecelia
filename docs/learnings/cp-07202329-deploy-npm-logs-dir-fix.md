## 生产部署失败补丁——npm --cache不够,还要--logs-dir（2026-07-20）

PR #4140 修完 `--cache` 后重新触发部署，还是原地失败，同一个 `mkdir '/Users/administrator/.npm'` Read-only file system 换了个触发点复发。

### 根本原因
`--cache` 只重定向 npm 的包缓存位置，不影响 npm 自己的运行 debug 日志——后者默认仍写 `$HOME/.npm/_logs`，除非显式传 `--logs-dir`。这次是安装过程中出现"tarball corrupted, trying again"警告触发了错误日志落盘，撞上同一个只读挂载点。上一轮排查只验证了 `--dry-run`（不触发日志写入路径），没验证过真实 `npm ci` 在有警告/重试场景下的完整行为，漏掉了这条支线。

### 下次预防
- [ ] 验证一个 CLI 工具的"某个默认路径不可写"问题时，不能只测最简单的成功路径（本次 `--dry-run` 跑通就以为修好了）——同一个工具经常有多个独立的默认路径配置项（cache/logs/temp等），必须逐个确认或者干脆整体重定向 HOME
- [ ] 同一个坑如果在同一份脚本文件里出现多次（本次 Brain 依赖同步 + 2 处 Dashboard npm install），修的时候要一次性全部对齐，不要只修当下报错的那一处，回归测试也要覆盖到全部同类调用（这次靠扩展已有 smoke 脚本的检查范围顺带抓出了另外两处遗漏）
