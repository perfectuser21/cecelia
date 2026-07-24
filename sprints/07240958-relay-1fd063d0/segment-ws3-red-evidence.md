# ws3 Red 证据

- workstream: `ws3`
- 开工基线（rebase 后）: `0698757a1aa46cf72793e4553469c64c69af6443`
- 共享合同测试 blob: `5f009c2ab6cc3714ac161df88958def344aafece`
- 允许实现文件: `codex-slot-broker.js`、`fleet-resource-cache.js`、`slot-allocator.js`、`codex-slot-agent.mjs`、`install-codex-slot.sh`、`agents.example.json`

## B08：missing fleet 必须容量为 0

命令：

```bash
node --input-type=module -e 'const m=await import("./packages/brain/src/slot-allocator.js");const n=m.getCodexMaxConcurrent();console.log(JSON.stringify({case:"missing-fleet-capacity",actual:n,expected:0}));process.exit(n===0?0:1)'
```

结果：`exit_code=1`，实际输出 `actual=3`，违反 missing/stale capacity 必须为 0。

## A03：Bash 3.2 与 modern Bash 原子失败

分别以 `/bin/bash` 3.2 与 `/opt/homebrew/bin/bash` 5.x 真执行：

```bash
CODEX_SLOT_CONFIG=<missing.json> <shell> scripts/install-codex-slot.sh --install-root <isolated-root>
```

两次均因 installer 不存在返回 `127`，未满足合同要求的 `78`。

## A04：双机 root 映射

`scripts/codex-slot-agent.mjs`、`scripts/install-codex-slot.sh`、`config/codex-slot/agents.example.json` 均不存在，xian-m1/xian-m4 的 root attest、machine/fleet 与 mmv stable node 映射尚未落地。
