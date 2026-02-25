// Content Hub Types

export interface Content {
  id: number;
  content_id: string;
  title: string;
  body?: string;
  type?: string;
  images?: string[];
  video_url?: string;
  cover_image?: string;
  status: string;
  scheduled_time?: Date;
  publish_date?: Date;
  source: string;
  notion_page_id?: string;
  tags?: string[];
  category?: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateContentDTO {
  title: string;
  body?: string;
  type: '图文' | '视频' | '短贴';
  images?: string[];
  video_url?: string;
  cover_image?: string;
  platforms?: string[];
  scheduled_time?: string;
  publish_date?: string;
  source?: 'notion' | 'dashboard';
  notion_page_id?: string;
  tags?: string[];
  category?: string;
}

export interface ContentPlatform {
  id: number;
  content_id: string;
  platform: string;
  post_id?: string;
  post_url?: string;
  video_url?: string;
  status: string;
  published_at?: Date;
  error_message?: string;
  created_at: Date;
  updated_at: Date;
}

export interface ContentMatchItem {
  title: string;
  publish_time: string;
}

export interface ContentMatchRequest {
  platform: string;
  items: ContentMatchItem[];
}

export interface ContentMatchResult {
  title: string;
  content_id: string;
  type: string;
  similarity: number;
}
