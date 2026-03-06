"use client";

export interface FeatureFlags {
  webSearch: boolean;
  emailAccess: boolean;
  voiceInput: boolean;
  voiceOutput: boolean;
  autoRouting: boolean;
  locationSharing: boolean;
  autocorrect: boolean;
  usProxy: boolean;
}

const DEFAULTS: FeatureFlags = {
  webSearch: true,
  emailAccess: true,
  voiceInput: true,
  voiceOutput: true,
  autoRouting: true,
  locationSharing: false,
  autocorrect: true,
  usProxy: false,
};

export function getFeatures(): FeatureFlags {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const stored = localStorage.getItem("jalza_features");
    if (stored) return { ...DEFAULTS, ...JSON.parse(stored) };
  } catch {
    // ignore
  }
  return DEFAULTS;
}
