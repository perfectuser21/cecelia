import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execSync, spawnSync } from 'child_process'
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, chmodSync, realpathSync } from 'fs'
import { resolve, join } from 'path'
import { tmpdir } from 'os'

/**
 * worktree-manage.sh cleanup 在 set -e 下被 ((cleaned++)) / ((skipped++)) 静默中断的回归测试
 *
 * Bug：脚本 `set -euo pipefail`，计数为 0 时 `((x++))` 的算术结果为 0 → 退出码 1，
 * 触发 set -e，cmd_cleanup 在第一个"未合并" worktree 处静默 exit 1。
 * 后果：init-or-check 达到 worktree 上限时自动清理失效（2026-10-07 实测 75/15）。
 *
 * 用仓库内脚本（非 ~/.claude/skills 副本）+ PATH 注入的假 gh 构造确定性场景。
 */

const SCRIPT = resolve(__dirname, '../../skills/dev/scripts/worktree-manage.sh')

describe('worktree-manage.sh cleanup — set -e 下计数器不得中断（任务 2a80319e）', () => {
  let root: string
  let mainRepo: string
  let wtBase: string
  let binDir: string

  const sh = (cmd: string) => execSync(cmd, { stdio: 'pipe', encoding: 'utf-8' })

  const addWorktree = (branch: string) => {
    const p = join(wtBase, branch)
    sh(`git -C "${mainRepo}" worktree add -q -b "${branch}" "${p}"`)
    return p
  }

  const runCleanup = (mergedBranch: string) =>
    spawnSync('bash', [SCRIPT, 'cleanup'], {
      cwd: mainRepo,
      encoding: 'utf-8',
      env: {
        ...process.env,
        PATH: `${binDir}:${process.env.PATH}`,
        WORKTREE_BASE: wtBase,
        FAKE_MERGED_BRANCH: mergedBranch,
      },
    })

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'wt-cleanup-')))
    mainRepo = join(root, 'main')
    wtBase = join(root, 'wts')
    binDir = join(root, 'bin')
    mkdirSync(mainRepo)
    mkdirSync(wtBase)
    mkdirSync(binDir)
    sh(
      `cd "${mainRepo}" && git init -q && git config user.email t@t && git config user.name t && git commit --allow-empty -m init -q && git branch -M main`
    )
    // 假 gh：仅当 --head 的分支等于 FAKE_MERGED_BRANCH 时返回已合并 PR 号 4242，否则返回空
    const fakeGh = `#!/usr/bin/env bash
head=""
while [[ $# -gt 0 ]]; do
  if [[ "$1" == "--head" ]]; then head="$2"; fi
  shift
done
if [[ -n "\${FAKE_MERGED_BRANCH:-}" && "$head" == "$FAKE_MERGED_BRANCH" ]]; then echo 4242; fi
exit 0
`
    writeFileSync(join(binDir, 'gh'), fakeGh)
    chmodSync(join(binDir, 'gh'), 0o755)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it.skipIf(!existsSync(SCRIPT))('两个未合并 worktree：exit 0，两个都"跳过"，汇总 移除 0 个 跳过 2 个', () => {
    addWorktree('cp-unmerged-a')
    addWorktree('cp-unmerged-b')

    const r = runCleanup('')
    const out = (r.stdout ?? '') + (r.stderr ?? '')

    expect(r.status, out).toBe(0)
    expect(out).toContain('跳过: cp-unmerged-a')
    expect(out).toContain('跳过: cp-unmerged-b')
    expect(out).toContain('清理完成：移除 0 个，跳过 2 个')
    expect(existsSync(join(wtBase, 'cp-unmerged-a'))).toBe(true)
    expect(existsSync(join(wtBase, 'cp-unmerged-b'))).toBe(true)
  })

  it.skipIf(!existsSync(SCRIPT))('一个已合并 + 一个未合并：已合并被移除，计数 移除 1 个 跳过 1 个', () => {
    addWorktree('cp-merged-x')
    addWorktree('cp-unmerged-y')

    const r = runCleanup('cp-merged-x')
    const out = (r.stdout ?? '') + (r.stderr ?? '')

    expect(r.status, out).toBe(0)
    expect(out).toContain('移除已合并 worktree')
    expect(out).toContain('跳过: cp-unmerged-y')
    expect(out).toContain('清理完成：移除 1 个，跳过 1 个')
    expect(existsSync(join(wtBase, 'cp-merged-x'))).toBe(false)
    expect(existsSync(join(wtBase, 'cp-unmerged-y'))).toBe(true)
    const branches = sh(`git -C "${mainRepo}" branch --list`)
    expect(branches).not.toContain('cp-merged-x')
    expect(branches).toContain('cp-unmerged-y')
  })

  it.skipIf(!existsSync(SCRIPT))('脚本内不再有 set -e 下会中断的 ((x++)) 自增', () => {
    const r = spawnSync('grep', ['-nE', '\\(\\([a-zA-Z_]+(\\+\\+|--)\\)\\)', SCRIPT], { encoding: 'utf-8' })
    expect(r.stdout).toBe('')
  })
})
