// Native fetch() client for the API Gateway (through the Vite /api proxy).
// The access token lives only in memory; the HttpOnly refresh cookie
// restores the session after a reload.
import { useCallback, useEffect, useRef, useState } from "react";

let accessToken = null;
let sessionLost = () => {};
let refreshing = null;

export class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

export function setAccessToken(token) {
  accessToken = token;
}

export function onSessionLost(callback) {
  sessionLost = callback;
}

// One refresh at a time, even when several requests hit 401 together.
export function refreshSession() {
  refreshing ??= fetch("/api/auth/refresh", { method: "POST" })
    .then(async (response) => {
      if (!response.ok) return null;
      const data = await response.json();
      accessToken = data.accessToken;
      return data;
    })
    .catch(() => null)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api(path, { method = "GET", body, raw = false, retry = true } = {}) {
  const response = await fetch(path, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && retry && accessToken) {
    if (await refreshSession()) return api(path, { method, body, raw, retry: false });
    sessionLost();
  }

  if (raw && response.ok) return response;

  let data = null;
  try {
    data = await response.json();
  } catch {
    // Some responses (images, empty bodies) are not JSON.
  }

  if (!response.ok) {
    throw new ApiError(data?.message || `Request failed (${response.status}).`, response.status);
  }
  return data;
}

// Builds "?a=1&b=2" from an object, skipping empty values.
export function query(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, value);
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}

// Last response per path. Revisiting a page shows this instantly and
// refreshes it in the background (stale-while-revalidate), so navigation
// never flashes loading skeletons for data already seen.
const cache = new Map();

export function clearApiCache() {
  cache.clear();
}

// Loads `path` and reloads when it changes. `refreshMs` polls in the
// background without showing the loading state again.
export function useApi(path, { refreshMs } = {}) {
  const [state, setState] = useState(() => ({
    data: cache.get(path) ?? null,
    error: null,
    loading: Boolean(path) && !cache.has(path),
  }));
  const current = useRef(path);
  current.current = path;

  const load = useCallback(
    async (quiet = false) => {
      if (!path) return;
      // With cached data, refresh quietly instead of showing skeletons.
      const cached = cache.get(path);
      if (cached !== undefined) setState({ data: cached, error: null, loading: false });
      else if (!quiet) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await api(path);
        cache.set(path, data);
        if (current.current === path) setState({ data, error: null, loading: false });
      } catch (error) {
        if (current.current === path) {
          setState((s) => ({ data: quiet || cached !== undefined ? s.data : null, error, loading: false }));
        }
      }
    },
    [path]
  );

  useEffect(() => {
    load(cache.has(path));
    if (!refreshMs) return undefined;
    const timer = setInterval(() => load(true), refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);

  return { ...state, reload: load };
}

// For buttons that save something. `run(fn)` shows the spinner while fn
// runs and keeps the error (if any) so the form can show it.
// Returns true when fn finished without an error.
//
//   const { busy, error, run } = useAction();
//   run(() => api("/api/...", { method: "POST", body }));
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async (action) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(err);
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return { busy, error, run, clearError };
}
