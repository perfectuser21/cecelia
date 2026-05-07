// packages/engine/tests/launcher/launcher-dry-run.test.ts
import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import { resolve } from 'path'

describe('claude-launch.sh / cecelia-run.sh dry-run 注入 session_id', () => {
  const claudeLaunch = resolve(__dirname, '../../../../scripts/claude-launch.sh')
  const ceceliaRun = resolve(__dirname, '../../../brain/scripts/cecelia-run.sh')

  it('claude-launch.sh --dry-run 输出含 --session-id <uuid>', () => {
    const out = execSync(`bash ${claudeLaunch} --dry-run`, { encoding: 'utf8', timeout: 5000 })
    expect(out).toMatch(/--session-id\s+[a-f0-9-]{8,}/)
  })

  it('cecelia-run.sh --dry-run 输出含 --session-id <uuid>', () => {
    const out = execSync(`bash ${ceceliaRun} --dry-run`, { encoding: 'utf8', timeout: 5000 })
    expect(out).toMatch(/--session-id\s+[a-f0-9-]{8,}/)
  })
})
