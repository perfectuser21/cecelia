# PRD — 修复 forensics-no-overwrite-smoke.sh 的四个缺陷

## 背景

`packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh` 是 R2「取证文件按运行实例唯一命名（防覆盖）」能力的 post-deploy smoke。原版存在四个缺陷，导致它**看起来在验证协议、实际只在验证脚本自己**：

1. **断言对象错误**：取证 prompt 文件是 smoke 自己 `echo >` 写的，断言只验证「自己写的文件存在」，没碰容器真实输出，协议是否生效完全不被检验。
2. **`|| true` 吞容器失败**：`docker run ... 2>/dev/null || true` 把容器非零退出吞掉，容器跑挂了 smoke 仍然继续。
3. **断言 3 同义反复**：`INST1` / `INST2` 是脚本自己生成且 while 循环强制不同的随机数，`[ "$INST1" = "$INST2" ]` 恒为假，断言恒真。
4. **全角括号 + 退出码假绿**：第 73 行 echo 文案里全角括号紧贴变量触发 bash「unbound variable」，脚本中断后退出码却仍为 0（假绿）。

## 方案

利用 entrypoint 的 `CECELIA_ENTRYPOINT_TEST=1` 短路模式（实测容器 stdout 打印 `PROMPT_FILE=<注入值>` 和 `STDOUT_FILE=<注入值>`）作为协议真实生效的唯一 oracle：

- 捕获 `docker run` 的 stdout，解析 `PROMPT_FILE=` / `STDOUT_FILE=` 两行，断言与注入的 env 值**精确一致**（修复缺陷 1）。
- `docker run` 用 `set +e` 捕获退出码，非零立即 FAIL（修复缺陷 2）。
- 断言 3 改为：两容器各自报告的 PROMPT_FILE 路径**互不相同**且**分别含各自实例后缀**（修复缺陷 3）。
- echo 文案全角括号改半角 + 用 `${VAR}` 花括号隔离变量；结尾显式 `exit 0`；`set -euo pipefail` 失败路径真实非零退出（修复缺陷 4）。

## 成功标准

- 宿主有 docker + cecelia/runner:latest 时，`bash packages/brain/scripts/smoke/forensics-no-overwrite-smoke.sh` 全绿 exit 0。
- 故意改坏注入的 env 值（如 STDOUT_FILE 指向错误路径）时，smoke **真的 FAIL 且非零退出**（断言以容器真实输出为 oracle）。
- 容器非零退出时 smoke 不再被 `|| true` 吞掉，立即 FAIL 非零退出。
- 脚本不再含全角括号紧贴变量的写法；结尾显式 `exit 0`。
