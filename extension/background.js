/**
 * Grok Mission Control — Background Service Worker (MV3)
 *
 * Responsibilities (future slices):
 * - Listen for action click or context menu "Start Mission from this page"
 * - Capture active tab context via chrome.tabs + scripting (Readability, selection, meta)
 * - Message the Mission Control page (new tab or side panel) with the snapshot
 * - Bridge permission decisions or other browser skills back into the ACP client
 *
 * For v0.2 this is a skeleton so the extension/ folder exists and can be loaded in Helium.
 */

chrome.action.onClicked.addListener(async (tab) => {
  // Placeholder: open the local Mission Control (user runs `bun dev`)
  chrome.tabs.create({ url: "http://localhost:3000" });
});

// Example: capture context (to be wired to a "New Mission" flow + ACP initial prompt)
async function getPageContext(tabId) {
  // In real code: inject Readability, return {url, title, selection, summary}
  return { url: "", title: "", selection: "", summary: "" };
}

console.log("[GrokMC] background service worker ready (extension skeleton v0.2)");
