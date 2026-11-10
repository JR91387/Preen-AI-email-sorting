// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Opening Preen's own pages: switch to the tab that already shows the
// page, and open a new tab only when there is none. runtime.getContexts (Thunderbird
// 127+) lists Preen's pages with their tab ids and needs no permission, unlike
// tabs.query({url}), which silently finds nothing without the "tabs" permission.

export const ACTIVITY_PAGE = 'ui/activity/activity.html';
export const OPTIONS_PAGE = 'ui/options/options.html';

async function openTabId(url) {
  try {
    const [context] = await messenger.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
    return context?.tabId ?? null;
  } catch {
    return null; // getContexts is missing or refused: the caller opens a new tab instead
  }
}

/** Shows Preen's page `path` (e.g. ACTIVITY_PAGE), reusing its open tab. */
export async function showPage(path) {
  const url = messenger.runtime.getURL(path);
  const tabId = await openTabId(url);
  if (tabId !== null) {
    let tab = null;
    try {
      tab = await messenger.tabs.update(tabId, { active: true });
    } catch {
      // The tab closed in the meantime: open a new one below.
    }
    if (tab) {
      try {
        // The tab may be in another window: bring that window to the front too.
        await messenger.windows.update(tab.windowId, { focused: true });
      } catch {
        // Not fatal: the tab is already the active one in its window.
      }
      return;
    }
  }
  if (path === OPTIONS_PAGE) await messenger.runtime.openOptionsPage();
  else await messenger.tabs.create({ url });
}
