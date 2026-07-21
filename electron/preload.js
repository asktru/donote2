const { contextBridge, ipcRenderer } = require('electron');

/**
 * Desktop-only capabilities for the Donote web app. Presence of
 * `window.donoteDesktop` is how the app detects the Electron shell's
 * extra powers.
 */
contextBridge.exposeInMainWorld('donoteDesktop', {
    appleCalendar: {
        status: () => ipcRenderer.invoke('apple-calendar:status'),
        requestAccess: () => ipcRenderer.invoke('apple-calendar:request'),
        calendars: () => ipcRenderer.invoke('apple-calendar:calendars'),
        events: (fromIso, toIso) =>
            ipcRenderer.invoke('apple-calendar:events', fromIso, toIso),
    },
    // Open an app-relative path (e.g. /n/<id>) in a new shell window —
    // Cmd-click "open in a new window".
    openWindow: (path) => ipcRenderer.invoke('donote:open-window', path),
});
