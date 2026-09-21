## Brain {VERSION} — crontab us-vps 腿被 host 逃逸二次包装，打到了 MMV 的网关

- #5463 给 us-vps 腿写了显式 `ssh root@172.17.0.1`（docker 网关=本机宿主），
  但仍然走 `run()` —— 它会再包一层 `buildHostCmd`，于是实际发出的是
  ssh→MMV→ssh 172.17.0.1，而 MMV 的 docker 网关不是 us-vps。上产后心跳
  `crontab/us-vps = unreachable`。改为直接 `exec()`：本腿自己就是完整 ssh 命令，
  容器直接能到 172.17.0.1，不需要也不能再逃一次。
- 新增两条守卫盯**实际发出的命令**（注入 `opts.exec` 抓 calls）：
  us-vps 腿不许被 host 逃逸包装、mmv 腿必须走包装。变异验证：把 `exec` 改回 `run`
  立刻真断言失败，报错原文直指病因。
- 这是 0921 同一处第三次栽在「落点假设没人验」：①以为逃逸到 us-vps（实为 MMV）
  ②修①时又被二次包装。前两次都是靠上产后查表才发现的，现在这条守卫在 CI 里就拦住。
