// contracts.mjs — 技能契约表（SSOT）
// 每技能必须声明 preconditions / postconditions / side_effects / sequence（契约完备性 lint 强制）。
// sequence 只固化「做什么」，禁止出现具体坐标——定位存 registry（key=model|app_version|density），
// 由运行时探针守护。依据 09-05 A/B 实测（决策 ca9f3d7b / 28ca1f69）。

export const SKILLS = {
  search_account: {
    description: '抖音内搜索指定账号并切换到搜索结果「用户」标签页',
    preconditions: [
      // B 臂唯一失败=抖音没起来（resetApp 只等 5s）——环境时序必须由 precondition 显式把关
      { type: 'foreground_app', pkg: 'com.ss.android.ugc.aweme' },
    ],
    postconditions: [
      // HONOR 上 uiautomator 在抖音搜索页必死（could not get idle state），postcondition 走视觉判定
      { type: 'vision_judge', judge: 'user_list_page' },
    ],
    side_effects: [
      { type: 'search_history_modified' },
    ],
    sequence: [
      { op: 'tapRole', role: 'search_entry' },
      { op: 'sleep', ms: 1500 },
      { op: 'type', from_arg: 'name' },
      { op: 'sleep', ms: 800 },
      { op: 'key', code: 'KEYCODE_ENTER' },
      { op: 'sleep', ms: 2500 },
      { op: 'tapRole', role: 'tab_users' },
      { op: 'sleep', ms: 2000 },
    ],
  },
};

// 视觉定位用的角色描述（给定位器的自然语言，不含坐标）
export const ROLE_DESC = {
  search_entry: '抖音首页右上角的「搜索」入口（放大镜图标）',
  tab_users: '搜索结果页顶部的「用户」标签页',
};
