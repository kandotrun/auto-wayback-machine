const SENSITIVE_PARAMS = [
  "token", "access_token", "refresh_token", "id_token", "session", "sessionid",
  "auth", "password", "passwd", "otp", "code", "api_key", "apikey", "secret",
  "signature", "sig",
];
const TRACKING_PARAMS = new Set([
  "fbclid", "gclid", "dclid", "msclkid", "mc_eid", "igshid", "_ga",
]);

export function isPrivateHost(host) {
  if (host === "localhost" || host.endsWith(".local")) return true;
  if (/^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const m = host.match(/^172\.(\d+)\./);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (host === "::1" || host.startsWith("[")) return true;
  return false;
}

export function hostExcluded(host, list) {
  return list.some((raw) => {
    const p = raw.trim().toLowerCase();
    if (!p) return false;
    if (p.startsWith("*.")) return host === p.slice(2) || host.endsWith(p.slice(1));
    return host === p || host.endsWith("." + p);
  });
}

export function normalise(rawUrl, settings) {
  let u;
  try { u = new URL(rawUrl); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";
  if (u.username || u.password) return null; // never send credential-embedded URLs
  if (settings.stripTracking) {
    for (const k of [...u.searchParams.keys()]) {
      if (k.toLowerCase().startsWith("utm_") || TRACKING_PARAMS.has(k.toLowerCase())) {
        u.searchParams.delete(k);
      }
    }
  }
  return u;
}

export function shouldSkip(u, settings) {
  const host = u.hostname.toLowerCase();
  if (isPrivateHost(host)) return "private-host";
  if (hostExcluded(host, settings.excludeHosts)) return "excluded-host";
  if (settings.excludePatterns.some((p) => p && u.href.includes(p))) return "excluded-pattern";
  if (settings.skipSensitiveQuery) {
    for (const k of u.searchParams.keys()) {
      if (SENSITIVE_PARAMS.includes(k.toLowerCase())) return "sensitive-query";
    }
  }
  return null;
}

