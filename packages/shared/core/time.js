// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Local-time helpers for file names and exports.

export const DAY_MS = 24 * 60 * 60 * 1000;

export const pad = (n) => String(n).padStart(2, '0');

/** Local date: YYYY-MM-DD. */
export function dateStamp(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Local date and time for file names: YYYY-MM-DD-HHMM. */
export function fileStamp(date = new Date()) {
  const d = new Date(date);
  return `${dateStamp(d)}-${pad(d.getHours())}${pad(d.getMinutes())}`;
}

/** Local date and time for reading, e.g. in a spreadsheet: YYYY-MM-DD HH:MM:SS. */
export function localTime(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return `${dateStamp(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
