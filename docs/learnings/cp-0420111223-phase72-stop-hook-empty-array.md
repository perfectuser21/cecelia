# cp-0420111223-phase72-stop-hook-empty-array — Learning

### 背景

Phase 7.2：修 hooks/stop.sh 空数组 `_STOP_HOOK_WT_LIST[@]` 在 bash 3.2 + set -u 下报 "unbound variable"。

### 根本原因

Phase 7.1 把 claude launcher 做好后，Stop Hook 首次在交互模式下被真正触发（之前 owner_session=unknown 永远匹配不上，hook 形同未启动）。触发后暴露一个**潜伏已久**的 bug：`_STOP_HOOK_WT_LIST=()` 在空数组状态下，`${arr[@]}` 在 bash 3.2（macOS 默认）+ `set -u` 下会报 unbound variable。Phase 7 没发现因为那时候 Hook 根本没进这些分支。

用户原话："stop hook error: Failed with non-blocking status code"——non-blocking 意思是 hook exit 非零但 Claude Code 没 block assistant，所以循环机制形同未生效。

### 下次预防

- [ ] 任何 bash 脚本用 `set -u` + 数组遍历：必须用 `${arr[@]+${arr[@]}}` guard 或 `${#arr[@]} -gt 0` 前置检查
- [ ] macOS 默认 bash 3.2 陷阱清单要列进 DoD 检查：`set -u` + 空数组、`[[ -v var ]]` 不支持（需 bash 4.2+）、关联数组不支持（bash 4.0+）
- [ ] 任何 hook 修复：必须在"真正被触发"的场景下跑过端到端；光跑 unit test 不够（Phase 7 就是只跑了 unit test 没跑真实 Stop Hook）
- [ ] `non-blocking status code` 错误信号对用户不可见时（Claude Code 只在 ctrl+o 展开显示），等于 silent failure——要有 CI 的 hook e2e 回归线
