// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Thunderbird returns message lists in pages; this walks them.

/**
 * Calls `visit(message)` for each message of a (possibly paged) list. When `visit`
 * returns true the walk stops and the rest of the list is released.
 * @returns {Promise<boolean>} whether `visit` stopped the walk
 */
export async function collectPages(firstPage, visit) {
  let page = firstPage;
  while (page) {
    for (const m of page.messages) {
      if (visit(m) === true) {
        if (page.id) await messenger.messages.abortList(page.id).catch(() => {});
        return true;
      }
    }
    page = page.id ? await messenger.messages.continueList(page.id) : null;
  }
  return false;
}
