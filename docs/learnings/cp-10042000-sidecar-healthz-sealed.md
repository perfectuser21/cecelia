# Learning：口径硬编码在部署链里有四份，修了三轮才修齐

### 根本原因
- 「Brain 是否健康」在部署链里被四处各自硬编码：官方收账 CLI（#5947）、sidecar 内联 node 的 /health 判断（#5949）、sidecar 的 `/healthz` 探针（本 PR）、Auto Staging Deploy 的 `wait-for-production-sha.sh`（本 PR）。每次只修到暴露的那一处，下一次真实部署才暴露下一处。
- `/healthz` 与 `/health` 是两个口径不同的端点（前者看 tick 存活，后者另有公式），我在 #5949 的 Learning 里写了「修口径前 git grep 全部读取点」，但当时 grep 的是 `status` 字段，没 grep 端点名，漏了 `/healthz`。
- 测试 fixture 里把 `curl -f` 的行为（HTTP 503 → exit 22）简化成「看场景直接返回 0/22」，导致第一次修复的测试在 fixture 里通过、在真实环境里失败。

### 下次预防
- [ ] grep 关键字要同时覆盖「端点路径」和「字段值」两类，修口径前先列出全部读取点清单再动手。
- [ ] fixture 要忠实复现外部工具的关键行为（curl -f 遇 4xx/5xx 退出 22），不要按场景名硬编码退出码。
- [ ] 部署链改动以一次真实部署验收（台账 pending 自动清空、staging 出包），不以单测绿为终点。
