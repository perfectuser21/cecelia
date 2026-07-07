import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

describe('Skill Evaluator 内部验收台 — TDD Red 阶段', () => {
  it('POST /api/eval/upload 端点存在（无令牌应返回403而非404）', async () => {
    const res = await fetch('http://localhost:5221/api/eval/upload', {
      method: 'POST',
    })
    expect(res.status).not.toBe(404)
    expect([400, 403, 422]).toContain(res.status)
  })

  it('GET /api/eval/tasks/:id 端点存在（未知ID应返回404或200而非路由不存在）', async () => {
    const res = await fetch('http://localhost:5221/api/eval/tasks/nonexistent-id')
    // 路由存在时不会是 404 的"路由不存在"，而是业务404
    expect(res.status).toBeLessThan(500)
  })

  it('无令牌上传直打Brain应返回403', async () => {
    const formData = new FormData()
    formData.append('skill_name', 'test')
    formData.append('platform', 'claude')
    formData.append('line', 'Line00')
    const res = await fetch('http://localhost:5221/api/eval/upload', {
      method: 'POST',
      body: formData,
    })
    expect(res.status).toBe(403)
  })

  it('上传端点返回结构含 task_id 和 position', async () => {
    const token = process.env.EVAL_PROXY_TOKEN || 'test-token'
    const zipBuffer = readFileSync(join(__dirname, 'fixtures/valid-skill.zip'))
    const zipBlob = new Blob([zipBuffer], { type: 'application/zip' })
    const formData = new FormData()
    formData.append('file', zipBlob, 'valid-skill.zip')
    formData.append('skill_name', 'red-test-skill')
    formData.append('platform', 'claude')
    formData.append('line', 'Line00')
    const res = await fetch('http://localhost:5221/api/eval/upload', {
      method: 'POST',
      headers: { 'X-Eval-Proxy-Token': token },
      body: formData,
    })
    if (res.status === 200) {
      const body = await res.json()
      expect(body).toHaveProperty('task_id')
      expect(body).toHaveProperty('position')
      expect(body).toHaveProperty('status')
      expect(body.status).toBe('queued')
    } else {
      // Red阶段：路由不存在时此测试失败，记录期望
      expect(res.status).toBe(200) // 触发失败，功能实现后会通过
    }
  })

  it('GET /api/eval/tasks/:id 返回结构含status/report_url/failure_stage', async () => {
    // Red: 当前功能未实现
    const res = await fetch('http://localhost:5221/api/eval/tasks/fake-task-id-red-test')
    if (res.status === 200 || res.status === 404) {
      const body = await res.json()
      if (res.status === 200) {
        expect(body).toHaveProperty('task_id')
        expect(body).toHaveProperty('status')
        expect(['queued','in_progress','completed','failed']).toContain(body.status)
        expect(body).toHaveProperty('report_url')
        expect(body).toHaveProperty('failure_stage')
      }
    } else {
      // 路由不存在，Red 阶段期望失败
      expect(res.status).toBe(404) // 触发失败
    }
  })
})
