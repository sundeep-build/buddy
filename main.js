// Buddy — main process.
// Owns the reminder schedule, the transparent overlay window the buddy walks in,
// the settings window and the menu-bar item.
const { app, BrowserWindow, Tray, Menu, screen, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PRESETS, DEFAULT_REMINDERS, DEFAULT_REPLIES } = require('./presets');
const { ROLES, inspectGlb, guessRoles } = require('./character');
const { ALL_DAYS, isActiveDay, nextTime } = require('./schedule');

const STAGE_HEIGHT = 500; // px strip along the bottom of the screen that the buddy walks in
const CHECK_SECONDS = 15; // how often the schedule is checked for a due reminder
const VISIT_WATCHDOG_SECONDS = 120; // a visit that never reports back is ended after this

let overlay = null; // the click-through window the buddy walks in
let overlayReady = false;
let settings = null; // the settings window, while it is open
let tray = null;
let visit = null; // the reminder being delivered right now
let queued = null; // a reminder waiting for the overlay to finish loading
let watchdog = null;
let cursorPoll = null;
let hitRect = null; // bounds of the speech bubble inside the overlay while it has buttons
let clickThrough = true;
let characterError = null; // why the custom character could not be shown, if it couldn't
const nextAt = new Map(); // reminder id → time of its next visit (ms)

let state = {
  reminders: DEFAULT_REMINDERS,
  character: null, // null = the built-in robot, else { name, clips, roles, yaw }
  paused: false,
  day: '',
  done: {}, // reminder id → "yes" answers today
};
const stateFile = () => path.join(app.getPath('userData'), 'state.json');
const characterFile = () => path.join(app.getPath('userData'), 'character.glb');

function loadState() {
  try {
    const saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8'));
    if (Array.isArray(saved.reminders)) state = { ...state, ...saved };
  } catch {
    // first run, or an unreadable file: keep the defaults
  }
  if (state.character && !fs.existsSync(characterFile())) state.character = null;
}

function saveState() {
  fs.mkdirSync(path.dirname(stateFile()), { recursive: true });
  fs.writeFileSync(stateFile(), JSON.stringify(state, null, 2));
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

// --- schedule ----------------------------------------------------------------

function plan(reminder, { retry = false } = {}) {
  nextAt.set(reminder.id, nextTime(reminder, { retry }));
}

function planAll() {
  nextAt.clear();
  for (const reminder of state.reminders) plan(reminder);
}

function checkDue() {
  if (visit || state.paused) return;
  const now = Date.now();
  // A reminder can come due on one of its days off if the computer slept through
  // its time; it waits for its next day instead.
  for (const reminder of state.reminders) {
    if (nextAt.get(reminder.id) <= now && !isActiveDay(reminder)) plan(reminder);
  }
  const due = state.reminders
    .filter((reminder) => reminder.enabled && nextAt.get(reminder.id) <= now)
    .sort((a, b) => nextAt.get(a.id) - nextAt.get(b.id));
  if (due.length) startVisit(due[0]);
}

// --- the overlay and a visit ---------------------------------------------------

function createOverlay() {
  overlay = new BrowserWindow({
    width: 800,
    height: STAGE_HEIGHT,
    show: false,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false, // never steal keyboard focus from the app the user is working in
    skipTaskbar: true,
    alwaysOnTop: true,
    acceptFirstMouse: true, // a click on the bubble should count even though the window is inactive
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      backgroundThrottling: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  // The Dock icon is shown and hidden along with the settings window instead.
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(path.join(__dirname, 'index.html'));
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    if (queued) startVisit(queued);
  });
}

// The overlay loads its character once, at startup, so a new character means a reload.
function reloadOverlay() {
  if (visit) endVisit('ignored');
  characterError = null;
  overlayReady = false;
  overlay.webContents.reload();
}

function setClickThrough(value) {
  if (value === clickThrough) return;
  clickThrough = value;
  overlay.setIgnoreMouseEvents(value, { forward: true });
}

// The overlay covers the whole bottom strip of the screen, so it lets every click
// through to the apps underneath except while the cursor is over the bubble.
function pollCursor() {
  if (!hitRect) return setClickThrough(true);
  const cursor = screen.getCursorScreenPoint();
  const bounds = overlay.getBounds();
  const x = cursor.x - bounds.x;
  const y = cursor.y - bounds.y;
  const inside =
    x >= hitRect.x && x <= hitRect.x + hitRect.width && y >= hitRect.y && y <= hitRect.y + hitRect.height;
  setClickThrough(!inside);
}

function startVisit(reminder) {
  if (visit) return;
  if (!overlayReady) {
    queued = reminder;
    return;
  }
  queued = null;
  visit = reminder;

  // Walk along the bottom of whichever screen the user is on, just above the Dock.
  const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
  overlay.setBounds({ x: area.x, y: area.y + area.height - STAGE_HEIGHT, width: area.width, height: STAGE_HEIGHT });
  overlay.showInactive();
  overlay.webContents.send('visit', { stage: { width: area.width, height: STAGE_HEIGHT }, reminder });

  cursorPoll = setInterval(pollCursor, 40);
  watchdog = setTimeout(() => endVisit('ignored'), VISIT_WATCHDOG_SECONDS * 1000);
  broadcast();
}

function endVisit(answer) {
  if (!visit) return;
  // The reminder may have been edited or deleted while the buddy was on screen.
  const reminder = state.reminders.find((r) => r.id === visit.id);
  visit = null;
  clearInterval(cursorPoll);
  clearTimeout(watchdog);
  hitRect = null;
  setClickThrough(true);
  overlay.hide();
  if (reminder) plan(reminder, { retry: answer !== 'yes' });
  broadcast();
}

ipcMain.on('overlay:hit-rect', (_event, rect) => {
  hitRect = rect;
});

ipcMain.handle('overlay:answered-yes', (_event, id) => {
  rollDay();
  state.done[id] = (state.done[id] || 0) + 1;
  saveState();
  broadcast();
  return state.done[id];
});

ipcMain.on('overlay:visit-done', (_event, answer) => endVisit(answer));

ipcMain.handle('overlay:character', () => {
  if (!state.character) return null;
  const { roles, yaw } = state.character;
  return { data: fs.readFileSync(characterFile()), roles, yaw };
});

ipcMain.on('overlay:character-failed', (_event, message) => {
  characterError = String(message);
  broadcast();
});

// --- settings ------------------------------------------------------------------

function openSettings() {
  if (settings) {
    settings.show();
    settings.focus();
    return;
  }
  settings = new BrowserWindow({
    width: 760,
    height: 720,
    minWidth: 560,
    minHeight: 480,
    title: 'Buddy',
    show: false,
    icon: path.join(__dirname, 'assets', 'icon.png'), // Windows and Linux; macOS uses the app's own icon
    autoHideMenuBar: true, // no File/Edit/View bar inside the window on Windows and Linux
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js') },
  });
  settings.loadFile(path.join(__dirname, 'settings.html'));
  settings.once('ready-to-show', () => settings.show());
  settings.on('closed', () => {
    settings = null;
    if (app.dock) app.dock.hide(); // keeps running from the menu bar
  });
  if (app.dock) app.dock.show();
}

// Everything the settings window shows.
function snapshot() {
  rollDay();
  return {
    reminders: state.reminders.map((reminder) => ({
      ...reminder,
      next: reminder.enabled && !state.paused ? whenLabel(nextAt.get(reminder.id)) : null,
      doneToday: state.done[reminder.id] || 0,
    })),
    character: state.character,
    characterError,
    paused: state.paused,
    visiting: visit ? visit.id : null,
    presets: PRESETS,
    roles: ROLES,
  };
}

// Pushes the current state to the settings window and the menu-bar item.
function broadcast() {
  refreshTray();
  if (settings) settings.webContents.send('settings:state', snapshot());
}

// Reminders arrive from the settings window; keep only well-formed values.
function cleanReminder(input, id) {
  const text = (value, fallback, max) =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : fallback;
  const daily = input.schedule?.type === 'daily' && /^([01]\d|2[0-3]):[0-5]\d$/.test(input.schedule.time);
  const minutes = Math.round(Number(input.schedule?.minutes)) || 30;
  const days = ALL_DAYS.filter((day) => Array.isArray(input.days) && input.days.includes(day));
  return {
    id,
    name: text(input.name, 'Reminder', 40),
    emoji: text(input.emoji, '⏰', 8),
    prop: input.prop === 'bottle' ? 'bottle' : 'emoji',
    question: text(input.question, 'Hey! Time for a break. Did you take one?', 140),
    yesReply: text(input.yesReply, DEFAULT_REPLIES.yes, 140),
    noReply: text(input.noReply, DEFAULT_REPLIES.no, 140),
    schedule: daily
      ? { type: 'daily', time: input.schedule.time }
      : { type: 'interval', minutes: Math.min(24 * 60, Math.max(1, minutes)) },
    days: days.length ? days : ALL_DAYS,
    enabled: input.enabled !== false,
  };
}

function useCharacterFile(file) {
  const { clips } = inspectGlb(file);
  fs.mkdirSync(path.dirname(characterFile()), { recursive: true });
  fs.copyFileSync(file, characterFile());
  state.character = { name: path.basename(file), clips, roles: guessRoles(clips), yaw: 0 };
  saveState();
  reloadOverlay();
}

ipcMain.handle('settings:get', () => snapshot());

ipcMain.handle('settings:save-reminder', (_event, input) => {
  const index = state.reminders.findIndex((r) => r.id === input.id);
  const reminder = cleanReminder(input, index === -1 ? crypto.randomUUID() : input.id);
  if (index === -1) state.reminders.push(reminder);
  else state.reminders[index] = reminder;
  plan(reminder);
  saveState();
  broadcast();
});

ipcMain.handle('settings:delete-reminder', (_event, id) => {
  state.reminders = state.reminders.filter((r) => r.id !== id);
  nextAt.delete(id);
  delete state.done[id];
  saveState();
  broadcast();
});

ipcMain.handle('settings:remind-now', (_event, id) => {
  const reminder = state.reminders.find((r) => r.id === id);
  if (reminder) startVisit(reminder);
});

ipcMain.handle('settings:set-paused', (_event, paused) => setPaused(paused));

// Resolves with an error message when the chosen file can't be used.
ipcMain.handle('settings:choose-character', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(settings, {
    title: 'Choose your character',
    properties: ['openFile'],
    filters: [{ name: '3D model (.glb)', extensions: ['glb'] }],
  });
  if (canceled) return null;
  try {
    useCharacterFile(filePaths[0]);
  } catch (error) {
    return error.message;
  }
  broadcast();
  return null;
});

ipcMain.handle('settings:set-character-options', (_event, { roles, yaw }) => {
  if (!state.character) return;
  for (const role of ROLES) {
    state.character.roles[role] = state.character.clips.includes(roles?.[role]) ? roles[role] : null;
  }
  state.character.yaw = [0, 90, 180, 270].includes(yaw) ? yaw : 0;
  saveState();
  reloadOverlay();
  broadcast();
});

ipcMain.handle('settings:reset-character', () => {
  state.character = null;
  fs.rmSync(characterFile(), { force: true });
  saveState();
  reloadOverlay();
  broadcast();
});

function setPaused(paused) {
  state.paused = Boolean(paused);
  if (!state.paused) planAll(); // don't fire everything that came due during the pause
  saveState();
  broadcast();
}

// --- menu bar ------------------------------------------------------------------

// "at 13:00", "tomorrow at 13:00" or "Monday at 13:00"
function whenLabel(at) {
  const date = new Date(at);
  const locale = app.getLocale(); // the same 12- or 24-hour clock the settings window shows
  const time = date.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });
  const daysAway = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86_400_000);
  if (daysAway === 0) return `at ${time}`;
  if (daysAway === 1) return `tomorrow at ${time}`;
  return `${date.toLocaleDateString(locale, { weekday: 'long' })} at ${time}`;
}

function refreshTray() {
  if (!tray) return;
  rollDay();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      // one line per reminder; clicking it calls the buddy for that reminder now
      ...state.reminders
        .filter((reminder) => reminder.enabled)
        .map((reminder) => ({
          label: `${reminder.emoji} ${reminder.name}${state.paused ? '' : ` — next ${whenLabel(nextAt.get(reminder.id))}`}`,
          enabled: !visit,
          click: () => startVisit(reminder),
        })),
      { type: 'separator' },
      { label: 'Open Buddy…', click: openSettings },
      { label: 'Pause reminders', type: 'checkbox', checked: state.paused, click: (item) => setPaused(item.checked) },
      { type: 'separator' },
      { label: 'Quit Buddy', role: 'quit' },
    ]),
  );
}

// --- app -----------------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (app.dock && !app.isPackaged) app.dock.setIcon(path.join(__dirname, 'assets', 'icon.png'));
    loadState();
    planAll();
    createOverlay();
    openSettings();

    if (process.platform === 'darwin') {
      // the menu bar shows text, so a 💧 title is enough
      tray = new Tray(nativeImage.createEmpty());
      tray.setTitle('💧');
    } else {
      // the Windows and Linux tray needs a picture; a click on it opens the settings
      tray = new Tray(path.join(__dirname, 'assets', 'tray.png'));
      tray.on('click', openSettings);
    }
    tray.setToolTip('Buddy');
    refreshTray();

    setInterval(checkDue, CHECK_SECONDS * 1000);
  });

  // Opening the app again (Finder, Dock, Spotlight) brings the settings window back.
  const reopen = () => {
    if (overlay) openSettings(); // "activate" can also arrive before the app is ready
  };
  app.on('activate', reopen);
  app.on('second-instance', reopen);

  // Closing the settings window leaves the buddy running in the menu bar.
  app.on('window-all-closed', () => {});
}
