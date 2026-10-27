// 原 US dispatch 模板的非敏感参数；凭据仅在读取时由 1Password 缓存注入。
export const DISPATCH_DEFAULTS = Object.freeze({
  "jinoshengyuan-daily.json": {
    "mode": "run",
    "tenant_id": "jinoshengyuan",
    "task_name": "金诺盛源｜西安AI训练师获客｜日增量",
    "task_request": {
      "task_name": "金诺盛源｜西安AI训练师获客｜日增量",
      "tenant_id": "jinoshengyuan",
      "audience": "西安及陕西省内，想学习人工智能训练师并了解报考、上课、补贴、就业的人",
      "keywords": [
        "西安 人工智能训练师"
      ],
      "search_policy": {
        "sort": "latest",
        "time_layers": [
          "one_day"
        ],
        "duration": "unlimited",
        "scope": "unlimited",
        "location": "same_city",
        "exhaust_visible_results": true
      },
      "qualification_policy": {
        "transcript_coverage": "full",
        "verdict_mode": "single_full_transcript",
        "low_confidence": "review"
      },
      "comment_policy": {
        "mode": "top_n",
        "window": "follow_video_layer",
        "batch_size": 5,
        "scheduler": "round_robin",
        "per_video_limit": 5
      },
      "scoring_policy": {
        "deliver_categories": [
          "strong_intent",
          "weak_intent"
        ],
        "low_confidence": "review"
      },
      "delivery_policy": {
        "destination": "tenant_final_leads",
        "dedupe": [
          "video",
          "comment",
          "person",
          "prior_runs"
        ],
        "external_outreach": false
      },
      "card_target": {
        "audience_key": "vps-status",
        "chat_id": "oc_ef60d6e3f199d90dd695b6ecc213d662",
        "visibility": "internal"
      }
    }
  },
  "yueshengyun-daily.json": {
    "mode": "run",
    "tenant_id": "yueshengyun",
    "task_request": {
      "task_name": "悦升云端｜西安企业 AI 办公获客｜日增量",
      "audience": "西安及陕西省内，重点西安及周边城市，想用 AI 办公、OPC、一人公司和 AI 智能化实现降本增效的企业老板与管理者",
      "keywords": [
        "西安企业AI办公"
      ],
      "search_policy": {
        "sort": "latest",
        "time_layers": [
          "one_day"
        ],
        "duration": "unlimited",
        "scope": "unlimited",
        "location": "unlimited",
        "exhaust_visible_results": true
      }
    }
  }
});
