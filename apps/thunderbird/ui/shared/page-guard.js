// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Loaded first on every Preen page, as a plain script, so it works even if
// the page's own script fails. It does two things:
//  - if the page's script fails (while loading or later), it shows a clear
//    message instead of leaving half-empty controls;
//  - if the page was built for a different Preen version than the one
//    installed (e.g. a stale cache or a half-finished update), it says so
//    and offers Reload.
(function preenPageGuard() {
  const pageVersion = document.querySelector('meta[name="preen-version"]')?.getAttribute('content');
  const api = globalThis.messenger ?? globalThis.browser;
  let shown = false;

  function banner(message, offerReload) {
    if (shown) return;
    shown = true;
    const show = () => {
      const box = document.createElement('div');
      box.className = 'page-error';
      box.setAttribute('role', 'alert');
      const text = document.createElement('p');
      text.textContent = message;
      box.append(text);
      if (offerReload) {
        const reload = document.createElement('button');
        reload.type = 'button';
        reload.textContent = 'Reload';
        reload.addEventListener('click', () => location.reload());
        box.append(reload);
      }
      document.body.prepend(box);
    };
    if (document.body) show();
    else document.addEventListener('DOMContentLoaded', show);
  }

  // Before the page has finished loading, an error means part of it is
  // missing; after that, only one action failed.
  let loading = document.readyState !== 'complete';
  window.addEventListener('load', () => { loading = false; });

  function reportError(raw) {
    const detail = String(raw ?? 'unknown error').slice(0, 300);
    banner(
      (loading
        ? 'Part of this Preen page didn\'t load properly, so some settings or buttons may be missing. '
        : 'Something went wrong on this Preen page, so the last action may not have worked. ')
      + 'Try Reload, or restart Thunderbird. If it keeps happening, please report it with this detail: '
      + detail,
      true,
    );
  }

  window.addEventListener('error', (event) => reportError(event.message ?? event.error?.message ?? event.error));
  // Failures in async start-up code (e.g. an awaited call that rejects).
  window.addEventListener('unhandledrejection', (event) => reportError(event.reason?.message ?? event.reason));

  const installed = api?.runtime?.getManifest?.().version;
  if (pageVersion && installed && pageVersion !== installed) {
    banner(
      `This page belongs to Preen ${pageVersion}, but Preen ${installed} is installed. `
      + 'Reload the page; if this message stays, restart Thunderbird.',
      true,
    );
  }
}());
