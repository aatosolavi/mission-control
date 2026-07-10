/**
 * T-0 — new-tab / action helper for Helium & Chromium.
 * Opens the local terminal UI. No page scripting.
 */

const TERMINAL_URL = "http://127.0.0.1:4321";

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: TERMINAL_URL });
});

console.log("[T-0] extension ready");
