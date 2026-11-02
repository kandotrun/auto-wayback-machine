export async function saveOne(url) {
  // Save Page Now: GET /save/<url> starts the capture and redirects to the snapshot.
  // We only need the response headers — cancelling the body keeps this cheap.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch("https://web.archive.org/save/" + url, {
      method: "GET",
      signal: controller.signal,
      credentials: "omit",
    });
    try { await res.body?.cancel(); } catch {}
    return { status: res.status };
  } finally {
    clearTimeout(timer);
  }
}

