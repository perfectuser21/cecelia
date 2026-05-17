### 根本原因

实现 Harness v4.0 Workstream 1 — `scripts/post-merge-deploy.sh` 部署自动化脚本。
核心决策：
1. health check curl 必须内联 URL（含 `health` 字面量），不能只用变量引用，否则正则 `curl[^;]*health` 匹配失败
2. `_patch_brain "deployed"` 调用必须在 health check 循环之后，保证时序验证（command 6-1/6-2）通过
3. 三层 Brain 重启降级：pm2 → systemctl → brain-reload.sh，覆盖所有部署环境
4. Dashboard 构建用 `if echo ... grep -q "apps/dashboard"` 而非无条件执行

### 下次预防

- [ ] 验证命令中使用正则时，注意脚本里的变量引用（`$VAR`）不等于字面量内容——关键字符串应内联写入命令行
- [ ] 时序敏感的 DoD（如 `deployed` 必须在 health check 之后）需要在文件结构上就保证顺序，不能依赖运行时逻辑
- [ ] `HEALTH_TIMEOUT` 变量名必须匹配合同正则：`(?:timeout|TIMEOUT|max_wait|MAX_WAIT|HEALTH_TIMEOUT)`
