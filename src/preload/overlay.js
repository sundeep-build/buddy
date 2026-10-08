// Bridge for the overlay window (the buddy).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  // Resolves with null for the built-in robot, else { data, roles, yaw } for the user's .glb.
  getCharacter: () => ipcRenderer.invoke('overlay:character'),
  // The user's .glb could not be shown; the robot is used instead.
  characterFailed: (message) => ipcRenderer.send('overlay:character-failed', message),
  // Main asks the buddy to come by: { stage: { width, height }, reminder }.
  onVisit: (callback) => ipcRenderer.on('visit', (_event, visit) => callback(visit)),
  // Records a "yes" for the reminder and resolves with today's count.
  answeredYes: (id) => ipcRenderer.invoke('overlay:answered-yes', id),
  // The area that should catch clicks (the bubble), or null to let everything through.
  setHitRect: (rect) => ipcRenderer.send('overlay:hit-rect', rect),
  // The buddy has left the screen; answer is 'yes', 'no' or 'ignored'.
  done: (answer) => ipcRenderer.send('overlay:visit-done', answer),
});
