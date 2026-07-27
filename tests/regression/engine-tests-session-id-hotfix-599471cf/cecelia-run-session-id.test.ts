import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(__dirname, '../../..')
const ceceliaRun = resolve(repoRoot, 'packages/brain/scripts/cecelia-run.sh')
const taskId = '58b733b8-ff1f-4120-a394-5bf8e38d4049'
const uuidPattern = '[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}'

function runDryRun(): string {
  return execFileSync('bash', [ceceliaRun, '--dry-run', taskId], {
    cwd: repoRoot,
    encoding: 'utf8',
    timeout: 5000,
  })
}

describe('cecelia-run dry-run session id 透传', () => {
  it('dry-run 输出含 --session-id UUID', () => {
    const output = runDryRun()

    expect(output).toMatch(new RegExp(`--session-id\\s+${uuidPattern}(?:\\s|$)`))
  })

  it('session id 单次生成且环境变量与 CLI 同值', () => {
    const output = runDryRun()
    const envSessionId = output.match(new RegExp(`CLAUDE_SESSION_ID=(${uuidPattern})(?:\\s|$)`))?.[1]
    const cliSessionIds = [
      ...output.matchAll(new RegExp(`--session-id\\s+(${uuidPattern})(?:\\s|$)`, 'g')),
    ].map((match) => match[1])

    expect(envSessionId).toBeDefined()
    expect(cliSessionIds).toHaveLength(1)
    expect(cliSessionIds[0]).toBe(envSessionId)
  })
})
