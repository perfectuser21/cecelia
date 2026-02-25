/**
 * Stats API - 多维度统计数据接口
 */

// import { apiClient } from './client'; // TODO: Uncomment when implementing real API

// ============ 类型定义 ============

// 平台统计数据
export interface PlatformStats {
  platform: string; // 平台名称（notion, feishu, xiaohongshu等）
  published: number; // 发布总数
  success: number; // 成功数
  failed: number; // 失败数
  successRate: number; // 成功率 (0-100)
}

// 时间序列数据点
export interface TimeSeriesDataPoint {
  timestamp: string; // ISO 8601 format
  value: number; // 数值
}

// 成功率数据
export interface SuccessRateData {
  success: number; // 成功任务数
  failed: number; // 失败任务数
  in_progress: number; // 进行中任务数
}

// ============ API 函数 ============

/**
 * 获取平台统计数据
 */
export async function fetchPlatformStats(): Promise<PlatformStats[]> {
  try {
    // TODO: 实际API端点
    // const response = await apiClient.get<PlatformStats[]>('/api/stats/platform');
    // return response.data;

    // Mock 数据（开发阶段）
    return [
      {
        platform: 'Notion',
        published: 120,
        success: 110,
        failed: 10,
        successRate: 91.7,
      },
      {
        platform: '飞书',
        published: 85,
        success: 80,
        failed: 5,
        successRate: 94.1,
      },
      {
        platform: '小红书',
        published: 95,
        success: 88,
        failed: 7,
        successRate: 92.6,
      },
      {
        platform: '抖音',
        published: 150,
        success: 135,
        failed: 15,
        successRate: 90.0,
      },
      {
        platform: '微信公众号',
        published: 65,
        success: 62,
        failed: 3,
        successRate: 95.4,
      },
      {
        platform: 'B站',
        published: 45,
        success: 40,
        failed: 5,
        successRate: 88.9,
      },
    ];
  } catch (error) {
    // Error silently handled, return empty array
    return [];
  }
}

/**
 * 获取时间序列数据
 * @param range - 时间范围：'24h' | '7d' | '30d'
 */
export async function fetchTimelineStats(
  range: '24h' | '7d' | '30d'
): Promise<TimeSeriesDataPoint[]> {
  try {
    // TODO: 实际API端点
    // const response = await apiClient.get<TimeSeriesDataPoint[]>(`/api/stats/timeline?range=${range}`);
    // return response.data;

    // Mock 数据（开发阶段）
    const now = new Date();
    const dataPoints: TimeSeriesDataPoint[] = [];

    if (range === '24h') {
      // 24小时，每小时一个数据点
      for (let i = 23; i >= 0; i--) {
        const time = new Date(now.getTime() - i * 60 * 60 * 1000);
        dataPoints.push({
          timestamp: time.toISOString(),
          value: Math.floor(Math.random() * 20) + 5,
        });
      }
    } else if (range === '7d') {
      // 7天，每天一个数据点
      for (let i = 6; i >= 0; i--) {
        const time = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        dataPoints.push({
          timestamp: time.toISOString(),
          value: Math.floor(Math.random() * 100) + 50,
        });
      }
    } else {
      // 30天，每天一个数据点
      for (let i = 29; i >= 0; i--) {
        const time = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
        dataPoints.push({
          timestamp: time.toISOString(),
          value: Math.floor(Math.random() * 120) + 60,
        });
      }
    }

    return dataPoints;
  } catch (error) {
    // Error silently handled, return empty array
    return [];
  }
}

/**
 * 获取成功率数据
 */
export async function fetchSuccessRateStats(): Promise<SuccessRateData> {
  try {
    // TODO: 实际API端点
    // const response = await apiClient.get<SuccessRateData>('/api/stats/success-rate');
    // return response.data;

    // Mock 数据（开发阶段）
    return {
      success: 615,
      failed: 45,
      in_progress: 12,
    };
  } catch (error) {
    // Error silently handled, return zero values
    return {
      success: 0,
      failed: 0,
      in_progress: 0,
    };
  }
}

// ============ 导出 ============

export const statsApi = {
  fetchPlatformStats,
  fetchTimelineStats,
  fetchSuccessRateStats,
};

export default statsApi;
