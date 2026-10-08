// Buddy — main process entry: starts everything and runs the reminder clock.
const { app } = require('electron');
const { state, loadState } = require('./state');
const scheduler = require('./scheduler');
const overlay = require('./overlay');
const settingsWindow = require('./settings-window');
const tray = require('./tray');
const paths = require('./paths');

const CHECK_SECONDS = 15; // how often the schedule is checked for a due reminder

function checkDue() {
  if (overlay.visiting() || state.paused) return;
  const reminder = scheduler.due();
  if (reminder) overlay.startVisit(reminder);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    if (app.dock && !app.isPackaged) app.dock.setIcon(paths.asset('icon.png'));
    loadState();
    scheduler.planAll();
    overlay.create();
    settingsWindow.register();
    settingsWindow.open();
    tray.create();

    setInterval(checkDue, CHECK_SECONDS * 1000);
  });

  // Opening the app again (Finder, Dock, Spotlight) brings the settings window back.
  const reopen = () => {
    if (overlay.exists()) settingsWindow.open(); // "activate" can also arrive before the app is ready
  };
  app.on('activate', reopen);
  app.on('second-instance', reopen);

  // Closing the settings window leaves the buddy running in the menu bar.
  app.on('window-all-closed', () => {});
}
