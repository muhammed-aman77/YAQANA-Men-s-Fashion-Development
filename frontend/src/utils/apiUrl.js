export const normalizeApiBaseUrl = (value) => {
  const baseUrl = typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
  return baseUrl || '/api';
};

export const API_BASE_URL = normalizeApiBaseUrl(import.meta.env?.VITE_API_BASE_URL);

export const resolveApiAssetUrl = (assetUrl, apiBaseUrl = API_BASE_URL) => {
  if (typeof assetUrl !== 'string' || !assetUrl.startsWith('/uploads/')) return assetUrl;

  if (/^https?:\/\//i.test(apiBaseUrl)) {
    return new URL(assetUrl, `${new URL(apiBaseUrl).origin}/`).toString();
  }

  if (typeof window !== 'undefined' && typeof window.location?.origin === 'string') {
    return new URL(assetUrl, `${window.location.origin}/`).toString();
  }

  return assetUrl;
};
