import { normalise, shouldSkip } from "./url.js";
import { isDuplicate } from "../background/history.js";

export function outlinksLimit(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(500, Math.max(0, Math.floor(n))) : 30;
}

export function canCollectOutlinks(sourceUrl, settings) {
  if (!settings.enabled || !settings.captureOutlinks) return false;
  const source = normalise(sourceUrl, settings);
  return Boolean(source && !shouldSkip(source, settings));
}

// Source host and its descendants only; siblings and parent hosts are not included.
export function sameHostOrSubdomain(host, sourceHost) {
  return host === sourceHost || host.endsWith("." + sourceHost);
}

export function selectOutlinks(sourceUrl, links, settings, savedMap = {}, queue = [], now = Date.now()) {
  if (!canCollectOutlinks(sourceUrl, settings) || !Array.isArray(links)) return [];
  const source = normalise(sourceUrl, settings);
  const result = [];
  const seen = new Set([source.href]);
  const limit = outlinksLimit(settings.outlinksMaxPerPage ?? 30);
  for (const raw of links) {
    if (result.length >= limit) break;
    if (typeof raw !== "string") continue;
    const url = normalise(raw, settings);
    if (!url || shouldSkip(url, settings) || seen.has(url.href)) continue;
    if (settings.outlinksSameDomainOnly && !sameHostOrSubdomain(url.hostname, source.hostname)) continue;
    if (isDuplicate(url.href, savedMap, queue, settings.dedupeHours, now)) continue;
    seen.add(url.href);
    result.push(url.href);
  }
  return result;
}
