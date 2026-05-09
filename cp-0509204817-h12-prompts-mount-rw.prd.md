# PRD: H12 cecelia-prompts mount ro→rw

**Brain task**: 8524336a-ca02-4ad0-a276-26add50f6706
**Spec**: docs/superpowers/specs/2026-05-09-h12-prompts-mount-rw-design.md
**Sprint**: langgraph-contract-enforcement / Stage 1 supplement-2

## 背景

W8 v13 实测：H7 (PR #2852) entrypoint.sh tee 写到 cecelia-prompts mount 是 :ro，写失败被 silent 吞，callback stdout 恒空 → evaluator FAIL 死循环 → terminal_fail。

## 修法

docker-executor.js:314 `:ro` → `:rw`。

## 成功标准

- buildDockerArgs 输出 cecelia-prompts mount 是 :rw
- 合并后 W8 v14 generator 容器写得了 ws1.stdout，brain 拿到 callback body 含真 stdout
- evaluator 不再恒 FAIL

## 不做

- 不动 entrypoint.sh / spawn detached / 其他 mount
- 不动 H7/H9/H8/H10/H11
