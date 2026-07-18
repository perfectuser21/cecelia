import { describe, it, expect } from 'vitest'
import { readFile, readdir } from 'fs/promises'
import { dirname, resolve, join } from 'path'
import { fileURLToPath } from 'url'

// 从测试文件自身定位 repo root（cwd 会随跑测的 package 变化，见 cockpit-route.test.ts 教训）
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')

// 背景（2026-07-18，task 935499cb）：OwnerCockpitPage 硬编码 http://localhost:5221，
// 浏览器端 localhost = 用户自己的设备 → 手机/HK 公网打开指挥舱全部指标空白。
// 规矩：dashboard 前端调 Brain 一律相对路径 /api/brain 走代理（先例 staffApi.ts），
// 本机 5211 frontend-proxy / HK 5211 / vite dev proxy 三条链路都已配好转发。
const FORBIDDEN = 'http://localhost:5221'
const SCAN_DIRS = ['apps/dashboard/src', 'apps/api/features']
const EXTENSIONS = ['.ts', '.tsx']

async function listSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const files: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue
      files.push(...(await listSourceFiles(full)))
    } else if (EXTENSIONS.some((ext) => entry.name.endsWith(ext))) {
      files.push(full)
    }
  }
  return files
}

describe('dashboard 前端禁止硬编码 Brain 地址（相对路径走代理）', () => {
  it(`apps/dashboard/src 与 apps/api/features 不得出现 ${FORBIDDEN} 字面量`, async () => {
    const violations: string[] = []
    for (const dir of SCAN_DIRS) {
      const files = await listSourceFiles(resolve(REPO_ROOT, dir))
      for (const file of files) {
        const content = await readFile(file, 'utf-8')
        if (content.includes(FORBIDDEN)) {
          const lines = content.split('\n')
          lines.forEach((line, i) => {
            if (line.includes(FORBIDDEN)) violations.push(`${file.replace(REPO_ROOT + '/', '')}:${i + 1}`)
          })
        }
      }
    }
    expect(violations, `硬编码 ${FORBIDDEN} 命中（改相对路径 /api/brain 走代理，先例 staffApi.ts）:\n${violations.join('\n')}`).toEqual([])
  })
})
