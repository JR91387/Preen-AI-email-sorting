// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Applies the "Appearance" setting to a page: Match Thunderbird ('auto') leaves
// color-scheme to the browser; Light and Dark force it. theme.css does the rest
// through light-dark(). Loaded as its own module script on every Preen page.

import { loadSettings } from '../../storage/settings.js';

const KEY = 'settings';

/** @param {string} appearance 'auto' | 'light' | 'dark' */
export function applyAppearance(appearance) {
  const scheme = appearance === 'light' || appearance === 'dark' ? appearance : '';
  document.documentElement.style.setProperty('color-scheme', scheme);
}

try {
  applyAppearance((await loadSettings()).appearance);
  messenger.storage.onChanged?.addListener((changes, area) => {
    if (area === 'local' && changes[KEY]) applyAppearance(changes[KEY].newValue?.appearance);
  });
} catch {
  // No stored settings or storage unavailable: keep the browser's colors.
}
