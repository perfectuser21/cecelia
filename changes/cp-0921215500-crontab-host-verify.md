## Brain {VERSION} — crontab 腿采错机器：落点假设写在注释里，没人验

- 上一版（#5461）按「`buildHostCmd` 逃出容器 = 到 us-vps 宿主」写了腿4。实际
  `CECELIA_HOST_EXEC_SSH` 生产值是 `administrator@100.71.151.105` —— **MMV**。
  上产后采到的是 MMV 的 crontab（janitor.sh / rescan-if-changed.sh /
  refresh-claude-tokens.sh / OrbStack），却标成 `host_alias='us-vps'`；
  真正要补的 us-vps 那 22 条一条没采到。**台账"有数据"但是错机器的，比没数据更坏——
  它看起来是好的。**
- 拆成两条腿：`crontab@mmv`（走 host-exec 默认逃逸）与 `crontab@us-vps`
  （显式 ssh `root@172.17.0.1` 回本机宿主；不用 `host.docker.internal`，
  Linux 上不解析，生产日志一直在报 `Could not resolve hostname`）。
- 两条腿的取数命令改为 `hostname; crontab -l`，解析时比对 hostname 与声明的
  host_alias，不符立刻抛错。**落点假设不能写在注释里靠人记，要让机器每轮自己验。**
- 守卫 +5 条（含"采到 MMV 的表却标 us-vps → 必须抛错"）、smoke +4 项断言。
