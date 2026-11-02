export function isDuplicate(url, savedMap, queue, dedupeHours, now = Date.now()) {
  const last = savedMap[url];
  if (last && now - last < dedupeHours * 3600_000) return true;
  return queue.some((item) => item.url === url);
}

export function pruneMap(map, now = Date.now()) {
  // Keep at most 5000 entries / 30 days so storage does not grow forever.
  const cutoff = now - 30 * 24 * 3600_000;
  const entries = Object.entries(map).filter(([, t]) => t > cutoff);
  entries.sort((a, b) => b[1] - a[1]);
  return Object.fromEntries(entries.slice(0, 5000));
}

