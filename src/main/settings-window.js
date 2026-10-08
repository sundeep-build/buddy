// The settings window and everything it can ask for.
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { PRESETS, DEFAULT_REPLIES } = require('./presets');
const { ROLES, inspectGlb, guessRoles } = require('./character');
const { ALL_DAYS } = require('./schedule');
const { state, events, changed, saveState, rollDay } = require('./state');
const scheduler = require('./scheduler');
const overlay = require('./overlay');
const paths = require('./paths');

let settings = null; // the settings window, while it is open

function open() {
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
    icon: paths.asset('icon.png'), // Windows and Linux; macOS uses the app's own icon
    autoHideMenuBar: true, // no File/Edit/View bar inside the window on Windows and Linux
    webPreferences: { preload: paths.preload('settings') },
  });
  settings.loadFile(paths.page('settings'));
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
  const visit = overlay.visiting();
  return {
    reminders: state.reminders.map((reminder) => ({
      ...reminder,
      next: reminder.enabled && !state.paused ? scheduler.nextLabel(reminder) : null,
      doneToday: state.done[reminder.id] || 0,
    })),
    character: state.character,
    characterError: overlay.characterError(),
    paused: state.paused,
    visiting: visit ? visit.id : null,
    presets: PRESETS,
    roles: ROLES,
  };
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
  fs.mkdirSync(path.dirname(paths.characterFile()), { recursive: true });
  fs.copyFileSync(file, paths.characterFile());
  state.character = { name: path.basename(file), clips, roles: guessRoles(clips), yaw: 0 };
  saveState();
  overlay.reload();
}

function register() {
  // Keeps the window up to date with everything that happens elsewhere.
  events.on('changed', () => settings && settings.webContents.send('settings:state', snapshot()));

  ipcMain.handle('settings:get', () => snapshot());

  ipcMain.handle('settings:save-reminder', (_event, input) => {
    const index = state.reminders.findIndex((r) => r.id === input.id);
    const reminder = cleanReminder(input, index === -1 ? crypto.randomUUID() : input.id);
    if (index === -1) state.reminders.push(reminder);
    else state.reminders[index] = reminder;
    scheduler.plan(reminder);
    saveState();
    changed();
  });

  ipcMain.handle('settings:delete-reminder', (_event, id) => {
    state.reminders = state.reminders.filter((r) => r.id !== id);
    scheduler.forget(id);
    delete state.done[id];
    saveState();
    changed();
  });

  ipcMain.handle('settings:remind-now', (_event, id) => {
    const reminder = state.reminders.find((r) => r.id === id);
    if (reminder) overlay.startVisit(reminder);
  });

  ipcMain.handle('settings:set-paused', (_event, paused) => scheduler.setPaused(paused));

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
    changed();
    return null;
  });

  ipcMain.handle('settings:set-character-options', (_event, { roles, yaw }) => {
    if (!state.character) return;
    for (const role of ROLES) {
      state.character.roles[role] = state.character.clips.includes(roles?.[role]) ? roles[role] : null;
    }
    state.character.yaw = [0, 90, 180, 270].includes(yaw) ? yaw : 0;
    saveState();
    overlay.reload();
    changed();
  });

  ipcMain.handle('settings:reset-character', () => {
    state.character = null;
    fs.rmSync(paths.characterFile(), { force: true });
    saveState();
    overlay.reload();
    changed();
  });
}

module.exports = { open, register };
