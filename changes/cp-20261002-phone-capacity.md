## Brain {VERSION} — 手机 HTTP 资源准入

- 手机HTTP预约仅接受成功native HTTP能力回执的内部观测身份；clone、caller verified/available与公开验签结果不能升权。
- Hub/physical/版本身份精确绑定，资源双采样五秒新鲜度及磁盘至少5GiB；物理预算复用calculatePhysicalCapacity和BASE_SLOT，再由锁内当前授权DB profile.capacity封顶。CPU/load/free-memory仅原始排序事实，不发明准入阈值。
- 共享整机锁内扣除真实attempt/capacity/unconfirmed-cleanup占位；锁等待后重新授权和核时效，unknown继续占位。同一历史租约只认原观测，过期仍读原unknown，不重分配。
- C6不接执行、不开放grant、不部署、不改cron，不把未部署主机协调当作排他证明。当前基线C1拒绝执行；后续合入C2须保留历史租约wire执行合同。
