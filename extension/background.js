async function openSidePanel(windowId) {
  try {
    await chrome.sidePanel.open({ windowId });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to open side panel', err);
  }
}

chrome.action.onClicked.addListener(async (tab) => {
  await openSidePanel(tab.windowId);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'openSidePanel' && sender.tab?.windowId) {
    openSidePanel(sender.tab.windowId).then(() => sendResponse({ ok: true })).catch((err) => sendResponse({ ok: false, error: String(err) }));
    return true;
  }
});

chrome.runtime.onInstalled.addListener(async () => {
  try {
    await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('Side panel behavior not supported', err);
  }
});
