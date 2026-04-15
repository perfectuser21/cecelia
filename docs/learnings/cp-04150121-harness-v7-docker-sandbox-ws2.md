### 根本原因

WS2 实现 Docker 容器化执行支持。核心改动：`docker/harness-runner/Dockerfile`（容器镜像定义）、`cecelia-run.sh`（条件分支 + docker run）、`executor.js`（`CONTAINER_SIZES` 常量）。

关键决策：
1. `CONTAINER_SIZES` 使用扁平 `{ light: 512, normal: 1024, heavy: 2048 }` 结构（非嵌套对象），使合同验证脚本的 `CONTAINER_SIZES\s*=\s*\{[\s\S]*?\}` 正则能完整匹配整个对象（嵌套 `{}` 导致非贪婪 `*?` 在第一个 `}` 截断）
2. Docker 模式默认关闭（`HARNESS_DOCKER_ENABLED` 未设置时走 setsid，零回归）
3. `_docker_available()` 用 `timeout 3 docker info` 防止 daemon 不可用时挂起

### 下次预防

- [ ] 合同验证脚本含 `/CONST\s*=\s*\{[\s\S]*?\}/` 正则时，常量必须使用扁平结构（不嵌套 `{}`）
- [ ] Docker 相关功能默认关闭，通过环境变量启用，保证向后兼容
- [ ] `_docker_available()` 等检测函数必须加超时（timeout 3），防止网络问题导致脚本挂起
