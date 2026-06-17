# Learning — forensics-no-overwrite-smoke.sh 假绿四缺陷

## 背景

R2「取证文件按运行实例唯一命名（防覆盖）」的 post-deploy smoke 表面在跑，实则四个缺陷叠加，把它变成一个**永远绿但什么都没验**的假 oracle。

### 根本原因

1. **断言对象搞错了 = oracle 自欺**：smoke 自己 `echo > $PROMPT_FILE` 写出取证文件，然后断言「该文件存在」。被验证的对象是脚本自己的副作用，**不是容器执行协议的产物**——容器哪怕原样不动，断言照样通过。真正的 oracle 必须是容器自身的输出（`CECELIA_ENTRYPOINT_TEST=1` 模式下 stdout 打印的 `PROMPT_FILE=`/`STDOUT_FILE=`），与注入的 env 精确比对才证明协议生效。
2. **`|| true` 吞错**：`docker run ... 2>/dev/null || true` 把容器非零退出吞掉，容器跑挂 smoke 也继续走完后续「断言」拿到假绿。
3. **同义反复断言**：`INST1`/`INST2` 是脚本自己 `crypto.randomBytes` 生成、且 while 循环已强制不同的随机数，再 `[ "$INST1" = "$INST2" ]` 判定恒为假——断言恒真，零信息量。
4. **全角括号 + set -e 假绿**：echo 文案里全角括号 `（$INST1 vs $INST2）` 紧贴变量，bash 把 `$INST2）` 当变量名 → `unbound variable` 中断；但因输出在命令替换/管道上下文，脚本退出码仍为 0，失败被掩盖成成功。

共性：**测试只验证了"自己能跑通自己"，没把真实被测系统接进断言回路**。CI/smoke 全绿 ≠ 协议正确。

### 下次预防

- 写 smoke/E2E 断言前先问：**这个断言的输入是被测系统的产物，还是测试脚本自己的副作用？** 后者一律重写。
- 任何外部进程调用（docker run / curl / ssh）禁止 `|| true` 收尾；用 `set +e; out=$(...); rc=$?; set -e` 捕获退出码，非零显式 FAIL。
- 断言两边的值若都由测试自己生成且被构造保证关系，就是同义反复，必须改为比较「被测系统报告的值」。
- `set -euo pipefail` 脚本结尾显式 `exit 0`；改坏一个输入手测一次，确认失败路径真的非零退出（red-green 自检）。
- 全角标点禁止出现在 bash 变量旁；变量一律 `${VAR}` 花括号隔离。

### Checklist

- [ ] smoke 断言的输入来自被测系统真实输出（容器 stdout），非脚本自写文件
- [ ] 外部进程调用捕获退出码，非零即 FAIL，无 `|| true`
- [ ] 无同义反复断言（两边比较的值至少一边来自被测系统）
- [ ] 脚本结尾显式 `exit 0`，且改坏输入手测过失败路径非零退出
- [ ] 无全角标点紧贴 bash 变量
