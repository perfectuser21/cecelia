## Codex 原生 coding workflow 通道（2026-10-12）

### 根本原因
- Claude 订阅组织禁用，API 余额不足。换执行器不能把 Codex 输出改名为 Claude 事件，也不能把未提供的美元费用写成零。
- 禁用 code_mode_host 会让当前 CLI 所有工具不可用；只禁 shell_tool/unified_exec，并提供限定工作树的只读文件 MCP，规格活动才能读取输入。
- Codex CLI 的 -c 动态路径不能直接拼进点分键：使用 TOML 内联表传权限路径，避免引号被当成文件名。

### 下次预防
- [ ] 新执行器先真实验证读文件、写规格、提交、QA只读git与禁网络，再起业务金丝雀。
- [ ] 原生命令记录缺失时拒绝证据，不用模型自述补造记录；未知费用贯穿保留null。
- [ ] provider切换使用单次仓库环境，不改默认登录或误伤其他仓库；无法等价映射的权限参数明确拒绝。

### 真实探针
- 原生 MCP 读取 package.json；原生 apply_patch 写入 marker 后独立读回相同内容。
- 构建原生 command_execution 在已登记隔离 checkout 创建 dde41b6；QA 同 checkout 提交返回 index.lock Operation not permitted/128，HEAD不变。
- 命令访问 example.com 因网络关闭退出6；仅有模型自述的探针不计作命令证据。
- 独立 ToAPIs gpt-5.6-sol 最小调用返回 PROBE_OK；没有使用构建会话自判。
