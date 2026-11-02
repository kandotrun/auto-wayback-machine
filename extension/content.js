// Read links only after the worker authorizes this source page. No page body is sent.
(async () => {
  try {
    const sourceUrl = location.href;
    const plan = await chrome.runtime.sendMessage({
      type: "pageReady", sourceUrl, title: document.title,
    });
    if (!plan?.collectOutlinks || location.href !== sourceUrl) return;
    const links = [...new Set(
      Array.from(document.querySelectorAll("a[href]"), (anchor) => anchor.href),
    )];
    await chrome.runtime.sendMessage({ type: "outlinks", sourceUrl, links });
  } catch {
    // The extension may be reloaded or the document may disappear during collection.
  }
})();
