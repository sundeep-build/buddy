// Works out when a reminder is next due.
// A reminder repeats every N minutes or comes once a day at a set time, on the days of the week chosen for it.

const RETRY_MINUTES = 10; // after "not yet" (or no answer) the buddy comes back sooner
const DAILY_RETRY_WINDOW_MINUTES = 60; // a daily reminder stops nagging this long after its time
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6]; // Sunday is 0, as in Date.getDay()

// Reminders saved before days could be chosen run every day.
const daysOf = (reminder) => reminder.days ?? ALL_DAYS;

function isActiveDay(reminder, date = new Date()) {
  return daysOf(reminder).includes(date.getDay());
}

// The most recent time a daily reminder was (or is) due: today's, or yesterday's if today's is still ahead.
function lastDailyTime(time, now) {
  const [hours, minutes] = time.split(':').map(Number);
  const at = new Date(now);
  at.setHours(hours, minutes, 0, 0);
  if (at.getTime() > now) at.setDate(at.getDate() - 1);
  return at;
}

// Moves a time forward to the reminder's next active day. A daily reminder keeps
// its time of day; a repeating one starts again at the beginning of that day.
function onActiveDay(reminder, time) {
  const at = new Date(time);
  for (let skipped = 0; skipped < 7 && !isActiveDay(reminder, at); skipped++) {
    at.setDate(at.getDate() + 1);
    if (reminder.schedule.type === 'interval') at.setHours(0, 0, 0, 0);
  }
  return at.getTime();
}

// `retry` is for a reminder that was just answered "not yet" or ignored.
function nextTime(reminder, { retry = false, now = Date.now() } = {}) {
  const { schedule } = reminder;
  if (schedule.type === 'interval') {
    const minutes = retry ? Math.min(RETRY_MINUTES, schedule.minutes) : schedule.minutes;
    return onActiveDay(reminder, now + minutes * 60_000);
  }
  const last = lastDailyTime(schedule.time, now);
  const retryAt = now + RETRY_MINUTES * 60_000;
  const stillFresh = retryAt - last.getTime() <= DAILY_RETRY_WINDOW_MINUTES * 60_000;
  if (retry && stillFresh && isActiveDay(reminder, last)) return retryAt;
  last.setDate(last.getDate() + 1);
  return onActiveDay(reminder, last.getTime());
}

module.exports = { ALL_DAYS, isActiveDay, nextTime };
