// judge.mjs — LLM 判定器：postcondition 视觉裁决的 prompt 构造 + fail-closed 解析
// 执行者自证不可信（09-05 A 臂 doneClaimed=true 实际停在桌面），裁决必须独立于执行者。
// 解析铁律 fail-closed：判定不了（空/非JSON/ok非布尔）= 失败，绝不默认成功。

export const JUDGES = {
  user_list_page: {
    system: '你是安卓界面判定器。只输出 JSON，不要解释。',
    user: (params) =>
      `这张抖音截图里，是否已经处于「搜索结果的用户列表页」并且出现了账号「${params.target}」？\n输出 {"ok":true|false,"why":"简短理由"}`,
  },
};

export function buildJudgePrompt(judgeName, params = {}) {
  const j = JUDGES[judgeName];
  if (!j) throw new Error(`unknown judge: ${judgeName}`);
  return { system: j.system, user: j.user(params) };
}

// fail-closed 解析：任何解析不出的形态一律 ok:false
export function parseJudgeVerdict(txt) {
  if (typeof txt !== 'string' || txt.length === 0) {
    return { ok: false, why: 'empty_or_non_string', parse_failed: true };
  }
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return { ok: false, why: 'no_json_found', parse_failed: true };
  let j;
  try { j = JSON.parse(m[0]); } catch {
    return { ok: false, why: 'json_parse_error', parse_failed: true };
  }
  if (typeof j.ok !== 'boolean') {
    return { ok: false, why: 'ok_not_boolean', parse_failed: true };
  }
  return { ok: j.ok, why: typeof j.why === 'string' ? j.why : '' };
}

// 对单张截图跑判定：visionFn(system, user, imgPath) -> Promise<string|null>
export async function judgeScreenshot({ visionFn, judge, imgPath, params }) {
  const { system, user } = buildJudgePrompt(judge, params);
  const txt = await visionFn(system, user, imgPath);
  return parseJudgeVerdict(txt);
}
