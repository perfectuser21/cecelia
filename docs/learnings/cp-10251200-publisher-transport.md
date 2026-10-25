## 快照发布运输期限（2026-10-25）

### 根本原因
实际GHA在300.315秒收到UND_ERR_HEADERS_TIMEOUT，而中央冷刷新稍后完成。AbortSignal的600秒总期限不覆盖Undici默认headers/body期限。旧发布器对transport错误闭口，既有409赢家处理不覆盖这类UNKNOWN。

### 下次预防
- [x] 先以Node22真实HTTP缩时headers/body回归取得具体超时RED，再显式配置私有Agent，不借全局dispatcher或Node私有实现。直接依赖精确锁定undici6.29.1，Node22受支持且包含近期安全修复。
- [x] Node22固定最终字节完整入口264/264通过；回归保留总deadline失败、原POST次数、完整验证和清理错误路径；失败不能等待graceful close，destroy失败不能覆盖原异常，包括undefined。
- [ ] 正式CI、正常合并和main正式发布尚待独立验收；不把本地测试或旧赢家回读计作新样本成功。

任务427d7e49-27c5-4612-b115-9214f03d47f9，actor=codex-headed-cw-reliability。仅开发事件附件，不替代Brain真身或冻结C01–C12。
