# OpenClaw 网关磁盘写满崩溃（09-28 22:59）

### 根本原因
- 网关每发布一代模型目录，都把 codex 插件（~294MB，含 codex 二进制）拷进 `~/.openclaw/tmp/openclaw-model-catalog-*` / `openclaw-plugin-build-*`。
- 旧网关实例被杀/重启后，这些 legacy 根目录无人认领：新版运行时不回收，`openclaw doctor --fix` 要求先停网关才肯删。9/23–9/26 攒了 45 个、约 14GB。
- 磁盘可用降到 0 → 07:59:13 PDT codex 插件加载 ENOSPC → 07:59:23 "unexpected runtime error" → 网关退出（launchd exit 1）。崩溃前的 SQLite 慢锁、liveness 延迟都是盘满的伴随症状，不是根因。
- MMV 上 janitor 的磁盘告警阈值 70% 早已常年越线（96%），告警等于没有。

### 修复
- `scripts/ops/openclaw-process-guard.sh`（MMV launchd 每 5 分钟跑）加职责⑤：回收超龄（6h）且无进程打开其中文件的 legacy 捕获根目录；磁盘可用 <10GB 报 FAULT + 告警。
- ⑤ 排在「网关在不在」早退之前——网关正是被写满的盘拖死的，不腾盘它起不来。

### 下次预防
- [ ] 看到 OpenClaw 网关无 FATAL 就退出，先 `grep ENOSPC /tmp/openclaw/openclaw-*.log` 再查内存/SQLite
- [ ] 新增的临时产物目录必须有回收方；「新版不认领旧格式」的升级要同时写清旧格式谁来删
- [ ] 水位告警阈值要贴近真正的致命点（本机 <10GB），常年越线的告警要收紧或删掉
