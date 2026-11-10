// SPDX-License-Identifier: PolyForm-Shield-1.0.0
// Message types sent between Preen's pages and its background script.

export const RUN_NOW = 'preen-run-now';
export const ACTIVITY_UPDATED = 'preen-activity-updated';

// Where a run publishes its progress, for the activity page's bar.
export const RUN_PROGRESS_KEY = 'runProgress';

// Alarm names (the activity page shows when the next scheduled run is).
export const SCHEDULE_ALARM = 'preen-schedule';
export const RUN_SOON_ALARM = 'preen-run-soon';

// Popup → background: classify these message IDs ({ ids, apply }).
export const CLASSIFY_IDS = 'preen-classify-ids';

// Background → confirm window → background: the answer to a large-run prompt ({ id, ok }).
export const CONFIRM_RESULT = 'preen-confirm-result';

// Activity page → background: stop runs in progress and waiting runs.
export const STOP_RUNS = 'preen-stop-runs';
