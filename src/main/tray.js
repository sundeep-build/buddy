// The menu-bar item (macOS) or tray icon (Windows and Linux).
const { Tray, Menu, nativeImage } = require('electron');
const { state, events, rollDay } = require('./state');
const scheduler = require('./scheduler');
const overlay = require('./overlay');
const settingsWindow = require('./settings-window');
const paths = require('./paths');

let tray = null;

function refresh() {
  rollDay();
  tray.setContextMenu(
    Menu.buildFromTemplate([
      // one line per reminder; clicking it calls the buddy for that reminder now
      ...state.reminders
        .filter((reminder) => reminder.enabled)
        .map((reminder) => ({
          label: `${reminder.emoji} ${reminder.name}${state.paused ? '' : ` — next ${scheduler.nextLabel(reminder)}`}`,
          enabled: !overlay.visiting(),
          click: () => overlay.startVisit(reminder),
        })),
      { type: 'separator' },
      { label: 'Open Buddy…', click: settingsWindow.open },
      {
        label: 'Pause reminders',
        type: 'checkbox',
        checked: state.paused,
        click: (item) => scheduler.setPaused(item.checked),
      },
      { type: 'separator' },
      { label: 'Quit Buddy', role: 'quit' },
    ]),
  );
}

function create() {
  if (process.platform === 'darwin') {
    // the menu bar shows text, so a 💧 title is enough
    tray = new Tray(nativeImage.createEmpty());
    tray.setTitle('💧');
  } else {
    // the Windows and Linux tray needs a picture; a click on it opens the settings
    tray = new Tray(paths.asset('tray.png'));
    tray.on('click', settingsWindow.open);
  }
  tray.setToolTip('Buddy');
  refresh();
  events.on('changed', refresh);
}

module.exports = { create };
