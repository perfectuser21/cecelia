// lib.mjs —— A/B 实验公共库：adb 封装 + 视觉调用 + 计费account
import { execFileSync, execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolveTmpRoot, scaleDown } from './platform.mjs';

export const DEV = process.env.AB_DEVICE || 'ANGYVB4227006983';
export const PKG = 'com.ss.android.ugc.aweme';
export const MODEL = process.env.AB_MODEL || 'gpt-5.5';
export const TMP = resolveTmpRoot();
if (!existsSync(TMP)) mkdirSync(TMP, { recursive: true });

const adbArgs = (...a) => ['-s', DEV, ...a];
export const adb = (...a) =>
  execFileSync('adb', adbArgs(...a), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
export const adbRaw = (...a) =>
  execFileSync('adb', adbArgs(...a), { maxBuffer: 64 * 1024 * 1024 });

export const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// ---------- 设备基础 ----------
let _size = null;
export function screenSize() {
  if (_size) return _size;
  const m = adb('shell', 'wm', 'size').match(/(\d+)x(\d+)/);
  _size = { w: +m[1], h: +m[2] };
  return _size;
}
export function density() {
  return +adb('shell', 'wm', 'density').match(/(\d+)/)[1];
}
export function appVersion() {
  const o = adb('shell', 'dumpsys', 'package', PKG);
  return (o.match(/versionName=([\d.]+)/) || [, 'unknown'])[1];
}
export function deviceModel() {
  return adb('shell', 'getprop', 'ro.product.model').trim();
}

// tap 用千分比坐标（跨分辨率可移植）
export function tapPermille(xp, yp) {
  const { w, h } = screenSize();
  adb('shell', 'input', 'tap', String(Math.round((xp / 1000) * w)), String(Math.round((yp / 1000) * h)));
}
export function typeText(t) {
  // 中文走 adb input text 会丢字，用 base64 + IME 不可靠；这里用 clipboard 粘贴兜底
  try {
    adb('shell', 'am', 'broadcast', '-a', 'clipper.set', '-e', 'text', t);
  } catch { /* ignore */ }
  execFileSync('adb', adbArgs('shell', 'input', 'text', t.replace(/ /g, '%s')), { encoding: 'utf8' });
}
export function key(k) { adb('shell', 'input', 'keyevent', k); }

export function screenshot(tag = 's') {
  const raw = `${TMP}/${tag}.png`;
  writeFileSync(raw, adbRaw('exec-out', 'screencap', '-p'));
  // 缩放失败会退回原图——费点 token，但绝不返回一个不存在的路径
  return scaleDown(raw, `${TMP}/${tag}-s.png`);
}

export function dumpXml(timeoutMs = 6000) {
  try {
    const out = execSync(
      `adb -s ${DEV} exec-out uiautomator dump /dev/tty 2>/dev/null`,
      { encoding: 'utf8', timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024 }
    );
    return out.includes('<hierarchy') ? out : null;
  } catch { return null; }
}

export function resetApp() {
  adb('shell', 'am', 'force-stop', PKG);
  sleep(800);
  adb('shell', 'monkey', '-p', PKG, '-c', 'android.intent.category.LAUNCHER', '1');
  sleep(5000);
}

// ---------- 视觉/LLM 调用（两臂共用，保证可比） ----------
export const usage = { calls: 0, prompt: 0, completion: 0 };

export async function vision(systemPrompt, userText, imgPath) {
  const b64 = readFileSync(imgPath).toString('base64');
  const body = {
    model: MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [
        { type: 'text', text: userText },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
      ] },
    ],
    temperature: 0,
    max_tokens: 400,
  };
  const r = await fetch(`${process.env.TOAPIS_BASE_URL.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.TOAPIS_API_KEY}` },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (j.usage) { usage.calls++; usage.prompt += j.usage.prompt_tokens || 0; usage.completion += j.usage.completion_tokens || 0; }
  const txt = j.choices?.[0]?.message?.content ?? '';
  return txt;
}

export function parseJson(txt) {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}
