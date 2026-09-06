// runtime.mjs — 技能体执行器 + 四级降级链（依赖注入版）
// SSOT 移植自 xian-m4 ~/ab-test/ab.mjs（09-05 A/B 实测 B 臂），重构为纯逻辑无 adb 依赖：
// deps 注入 tap/typeText/key/sleep/screenshot/vision/registry/regKey，CI 可 mock 全测。
// 降级链：registry 命中（零视觉调用）→ 视觉回源 → 回写 registry；视觉 null → fail-closed 不许瞎点。
import { SKILLS, ROLE_DESC } from './contracts.mjs';

function parseJson(txt) {
  if (typeof txt !== 'string') return null;
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

export function createSkillRuntime(deps) {
  const { tap, typeText, key, sleep, screenshot, vision, registry, regKey } = deps;

  // 四级降级链：cache → vision 回源+回写 → fail（fail-closed，绝不猜坐标）
  async function tapRole(role, stat) {
    const reg = registry.load();
    const k = regKey();
    const hit = reg[k]?.[role];
    if (hit) {
      tap(hit.x, hit.y);
      stat.hits++;
      return 'cache';
    }
    const img = screenshot(`locate-${role}`);
    const txt = await vision(
      '你是安卓界面元素定位器。只输出 JSON，不要解释。',
      `在这张截图里找到：${ROLE_DESC[role]}\n输出中心点千分比坐标 {"x":<0-1000>,"y":<0-1000>}（左上为原点）。找不到输出 {"x":null,"y":null}`,
      img
    );
    const j = parseJson(txt);
    if (j?.x == null || j?.y == null) {
      stat.misses++;
      return 'fail';
    }
    tap(j.x, j.y);
    const next = registry.load();
    next[k] = next[k] || {};
    next[k][role] = { x: j.x, y: j.y, learned_at: new Date().toISOString() };
    registry.save(next);
    stat.misses++;
    return 'vision';
  }

  // 按契约 sequence 执行技能——契约是唯一事实来源
  async function runSkill(name, args = {}) {
    const skill = SKILLS[name];
    if (!skill) throw new Error(`unknown skill（契约表里不存在）: ${name}`);
    const stat = { hits: 0, misses: 0 };
    for (const step of skill.sequence) {
      switch (step.op) {
        case 'tapRole': {
          const r = await tapRole(step.role, stat);
          if (r === 'fail') {
            return { ok: false, failedRole: step.role, reason: 'vision_locate_failed', cacheHits: stat.hits, cacheMisses: stat.misses };
          }
          break;
        }
        case 'type':
          typeText(step.from_arg ? args[step.from_arg] : step.text);
          break;
        case 'key':
          key(step.code);
          break;
        case 'sleep':
          sleep(step.ms);
          break;
        default:
          throw new Error(`unknown op in contract sequence: ${step.op}`);
      }
    }
    return { ok: true, cacheHits: stat.hits, cacheMisses: stat.misses };
  }

  return { tapRole, runSkill };
}
