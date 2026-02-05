// Feature data placeholder
export const features: any[] = [];
export const featuresData = [];

export function getFeatureStats() {
  return {
    total: 0,
    byCategory: {},
    byStatus: {},
    byPriority: {},
  };
}

export function getFeatureDependencies(featureId: string) {
  return [];
}

export function getFeatureDependents(featureId: string) {
  return [];
}

export type Feature = any;
export type FeatureCategory = string;
export type FeatureInstance = string;
export type FeaturePriority = string;
export type FeatureStatus = string;
