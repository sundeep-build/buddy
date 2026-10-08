// What Buddy remembers between launches, and the one place that announces changes.
const { EventEmitter } = require('events');
const path = require('path');
const fs = require('fs');
const { DEFAULT_REMINDERS } = require('./presets');
const paths = require('./paths');

const state = {
  reminders: DEFAULT_REMINDERS,
  character: null, // null = the built-in robot, else { name, clips, roles, yaw }
  paused: false,
  day: '',
  done: {}, // reminder id → "yes" answers today
};

// Emits 'changed' whenever what the settings window or the menu-bar item shows may be out of date.
const events = new EventEmitter();
const changed = () => events.emit('changed');

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(paths.stateFile(), 'utf8'));
    if (Array.isArray(saved.reminders)) Object.assign(state, saved);
  } catch {
    // first run, or an unreadable file: keep the defaults
  }
  if (state.character && !fs.existsSync(paths.characterFile())) state.character = null;
}

function saveState() {
  fs.mkdirSync(path.dirname(paths.stateFile()), { recursive: true });
  fs.writeFileSync(paths.stateFile(), JSON.stringify(state, null, 2));
}

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The "done today" counts are per day.
function rollDay() {
  if (state.day === today()) return;
  state.day = today();
  state.done = {};
  saveState();
}

module.exports = { state, events, changed, loadState, saveState, rollDay };
