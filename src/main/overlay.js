// The transparent overlay window the buddy walks in, and the visit it is making.
const { BrowserWindow, screen, ipcMain } = require('electron');
const fs = require('fs');
const { state, saveState, rollDay, changed } = require('./state');
const scheduler = require('./scheduler');
const paths = require('./paths');

const STAGE_HEIGHT = 500; // px strip along the bottom of the screen that the buddy walks in
const VISIT_WATCHDOG_SECONDS = 120; // a visit that never reports back is ended after this

let overlay = null; // the click-through window the buddy walks in
let overlayReady = false;
let visit = null; // the reminder being delivered right now
let queued = null; // a reminder waiting for the overlay to finish loading
let watchdog = null;
let cursorPoll = null;
let hitRect = null; // bounds of the speech bubble inside the overlay while it has buttons
let clickThrough = true;
let characterError = null; // why the custom character could not be shown, if it couldn't

function create() {
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
      preload: paths.preload('overlay'),
      backgroundThrottling: false,
    },
  });
  overlay.setAlwaysOnTop(true, 'screen-saver');
  // The Dock icon is shown and hidden along with the settings window instead.
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.loadFile(paths.page('overlay'));
  overlay.webContents.on('did-finish-load', () => {
    overlayReady = true;
    if (queued) startVisit(queued);
  });
  registerIpc();
}

// The overlay loads its character once, at startup, so a new character means a reload.
function reload() {
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
  changed();
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
  if (reminder) scheduler.plan(reminder, { retry: answer !== 'yes' });
  changed();
}

function registerIpc() {
  ipcMain.on('overlay:hit-rect', (_event, rect) => {
    hitRect = rect;
  });

  ipcMain.handle('overlay:answered-yes', (_event, id) => {
    rollDay();
    state.done[id] = (state.done[id] || 0) + 1;
    saveState();
    changed();
    return state.done[id];
  });

  ipcMain.on('overlay:visit-done', (_event, answer) => endVisit(answer));

  ipcMain.handle('overlay:character', () => {
    if (!state.character) return null;
    const { roles, yaw } = state.character;
    return { data: fs.readFileSync(paths.characterFile()), roles, yaw };
  });

  ipcMain.on('overlay:character-failed', (_event, message) => {
    characterError = String(message);
    changed();
  });
}

module.exports = {
  create,
  reload,
  startVisit,
  exists: () => Boolean(overlay),
  visiting: () => visit, // the reminder being delivered right now, or null
  characterError: () => characterError,
};
