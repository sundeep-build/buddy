// Bridge for the settings window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  // Called with the full state every time something changes.
  onState: (callback) => ipcRenderer.on('settings:state', (_event, state) => callback(state)),
  saveReminder: (reminder) => ipcRenderer.invoke('settings:save-reminder', reminder),
  deleteReminder: (id) => ipcRenderer.invoke('settings:delete-reminder', id),
  remindNow: (id) => ipcRenderer.invoke('settings:remind-now', id),
  setPaused: (paused) => ipcRenderer.invoke('settings:set-paused', paused),
  // Opens a file picker; resolves with an error message if the file can't be used.
  chooseCharacter: () => ipcRenderer.invoke('settings:choose-character'),
  setCharacterOptions: (options) => ipcRenderer.invoke('settings:set-character-options', options),
  resetCharacter: () => ipcRenderer.invoke('settings:reset-character'),
});
