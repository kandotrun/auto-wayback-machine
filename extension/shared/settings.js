export const DEFAULT_SETTINGS = {
  enabled: true,
  dedupeHours: 24,          // same URL is not re-saved within this window
  minIntervalSec: 8,        // Wayback limit is ~15 saves/min; stay well under it
  stripTracking: true,      // remove utm_*, fbclid, gclid... before saving / dedupe
  skipSensitiveQuery: true, // skip URLs whose query has token/session/auth/password etc.
  excludeHosts: [
    "localhost",
    "127.0.0.1",
    "web.archive.org",
    "archive.org",
    "accounts.google.com",
    "mail.google.com",
  ],
  excludePatterns: [], // substrings matched against the full URL
};

