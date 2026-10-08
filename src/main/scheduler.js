// Keeps track of when each reminder is next due.
const { app } = require('electron');
const { state, saveState, changed } = require('./state');
const { isActiveDay, nextTime } = require('./schedule');

const nextAt = new Map(); // reminder id → time of its next visit (ms)

function plan(reminder, { retry = false } = {}) {
  nextAt.set(reminder.id, nextTime(reminder, { retry }));
}

function planAll() {
  nextAt.clear();
  for (const reminder of state.reminders) plan(reminder);
}

const forget = (id) => nextAt.delete(id);

// The reminder that has been waiting longest, if any is due.
function due() {
  const now = Date.now();
  // A reminder can come due on one of its days off if the computer slept through
  // its time; it waits for its next day instead.
  for (const reminder of state.reminders) {
    if (nextAt.get(reminder.id) <= now && !isActiveDay(reminder)) plan(reminder);
  }
  return state.reminders
    .filter((reminder) => reminder.enabled && nextAt.get(reminder.id) <= now)
    .sort((a, b) => nextAt.get(a.id) - nextAt.get(b.id))[0];
}

function setPaused(paused) {
  state.paused = Boolean(paused);
  if (!state.paused) planAll(); // don't fire everything that came due during the pause
  saveState();
  changed();
}

// When a reminder comes next: "at 13:00", "tomorrow at 13:00" or "Monday at 13:00"
function nextLabel(reminder) {
  const at = nextAt.get(reminder.id);
  const date = new Date(at);
  const locale = app.getLocale(); // the same 12- or 24-hour clock the settings window shows
  const time = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const daysAway = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (daysAway === 0) return `at ${time}`;
  if (daysAway === 1) return `tomorrow at ${time}`;
  return `${date.toLocaleDateString(locale, { weekday: 'long' })} at ${time}`;
}

module.exports = { plan, planAll, forget, due, setPaused, nextLabel };
