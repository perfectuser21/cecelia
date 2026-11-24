export const standaloneWorkflows = Object.freeze({
  '101': 'douyin_video_discovery',
  '102': 'douyin_video_processing',
  '103': 'douyin_comment_scoring',
  '104': 'douyin_lead_outreach',
});

export const standaloneSources = Object.freeze(Object.keys(standaloneWorkflows).map(stage => `notion_leadgen_${stage}`));
export const standaloneSourceList = standaloneSources.map(source => `'${source}'`).join(', ');
