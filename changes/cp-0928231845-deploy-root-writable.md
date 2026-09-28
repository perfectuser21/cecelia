## Brain {VERSION} — 部署根去掉 packages/workflows 只读子挂载：改该目录的提交不再让部署失败

- 09-28 事故：brain 容器在可写部署根 `/root/cecelia` 内又同路径叠挂 `packages/workflows:ro`；部署根守卫在容器内 `git checkout -f` / `reset --hard`，#5618 改了 `packages/workflows/KERNEL_CONTEXT.md` 后报 `unable to unlink ... Read-only file system`，Gate3 01:24–02:16Z 连续 4 次失败无人察觉，1.335.2 与迁移 480/481 卡在生产之外（当时经宿主机 reset 手修恢复）。
- `docker-compose.us-vps.yml` / `docker-compose.yml` 删除该只读子挂载，目录随部署根整体可写。
- 回归守卫 `compose-deploy-root-writable.test.js`：部署根整体可写挂载时，根内不得有同路径 `:ro` 子挂载（先红后绿）。
