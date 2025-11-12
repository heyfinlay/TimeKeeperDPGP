const resolveEnv = () => {
  if (typeof import.meta !== 'undefined' && import.meta?.env) {
    return import.meta.env;
  }
  if (typeof process !== 'undefined' && process?.env) {
    return process.env;
  }
  return {};
};

const rawEnv = resolveEnv();

const parseFlag = (value, fallback = false) => {
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  const normalised = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalised)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalised)) {
    return false;
  }
  return fallback;
};

export const featureFlags = {
  tote_v2_math: parseFlag(rawEnv?.VITE_FLAG_TOTE_V2_MATH ?? rawEnv?.VITE_TOTE_V2_MATH, true),
};

export const isFeatureEnabled = (flag) => Boolean(featureFlags?.[flag]);

export const TOTE_V2_ENABLED = featureFlags.tote_v2_math;

export default featureFlags;
