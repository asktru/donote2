const { execFile } = require('child_process');
const path = require('path');
const {
    app,
    BrowserWindow,
    desktopCapturer,
    ipcMain,
    Menu,
    shell,
} = require('electron');

/**
 * The Donote web app this shell wraps — the production deployment by
 * default. `npm start` (dev) overrides it back to the local Herd site
 * via DONOTE_URL.
 */
const APP_URL = process.env.DONOTE_URL || 'https://donote.on-forge.com';

/** Reload (skipping cache) when refocused after this long — keeps the
 *  long-running shell from pinning a week-old deploy. */
const STALE_RELOAD_MS = 12 * 60 * 60 * 1000;

/** Every open shell window. Each is independent; the app supports many. */
const windows = new Set();
/** Per-window timestamp of the last successful load, for stale-reload. */
const lastLoadAt = new WeakMap();

/** The window a deep link or menu action should target: the focused one,
 *  falling back to the most recently opened. */
function primaryWindow() {
    return (
        BrowserWindow.getFocusedWindow() ??
        [...windows].at(-1) ??
        null
    );
}

/**
 * Open a shell window. Defaults to the app root; pass a same-origin URL to
 * land directly on a note (Cmd-click "open in new window", deep links).
 * Windows cascade automatically and manage their own lifecycle.
 */
function createWindow(targetUrl = APP_URL) {
    const win = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 900,
        minHeight: 600,
        titleBarStyle: 'hiddenInset',
        trafficLightPosition: { x: 14, y: 14 },
        backgroundColor: '#ffffff',
        webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            spellcheck: true,
            preload: path.join(__dirname, 'preload.js'),
        },
    });

    windows.add(win);

    // target=_blank links (Google Calendar events, external URLs) open in
    // the system browser; everything else stays in the shell.
    win.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);

        return { action: 'deny' };
    });

    win.webContents.on('did-fail-load', (_event, code, description) => {
        if (code !== -3) {
            win.loadFile(path.join(__dirname, 'offline.html'), {
                query: { url: APP_URL, error: description },
            });
        }
    });

    // Voice memos ask for getDisplayMedia purely to mix system audio
    // (Meet/Preply participants on speakers or AirPods) with the mic.
    // 'loopback' captures system output via ScreenCaptureKit; the video
    // track is discarded by the renderer immediately.
    win.webContents.session.setDisplayMediaRequestHandler(
        (_request, callback) => {
            desktopCapturer
                .getSources({ types: ['screen'] })
                .then((sources) => {
                    callback({ video: sources[0], audio: 'loopback' });
                })
                .catch(() => callback({}));
        },
    );

    win.loadURL(targetUrl);
    lastLoadAt.set(win, Date.now());

    win.webContents.on('did-finish-load', () => {
        lastLoadAt.set(win, Date.now());
    });

    // The app runs for weeks; without this it would keep serving whatever
    // bundle was current at launch. When focus returns after half a day,
    // pull fresh assets — local notes and the last view survive reloads.
    win.on('focus', () => {
        if (Date.now() - (lastLoadAt.get(win) ?? 0) > STALE_RELOAD_MS) {
            win.webContents.reloadIgnoringCache();
        }
    });

    win.on('closed', () => {
        windows.delete(win);
    });

    return win;
}

/**
 * Cmd-click "open in a new window": the renderer passes an app-relative
 * path (e.g. /n/<id>). Resolve it against APP_URL and refuse anything that
 * isn't same-origin, then open it in a fresh window.
 */
const APP_ORIGIN = new URL(APP_URL).origin;

ipcMain.handle('donote:open-window', (_event, path) => {
    if (typeof path !== 'string') {
        return;
    }

    let target;

    try {
        target = new URL(path, APP_URL);
    } catch {
        return;
    }

    if (target.origin !== APP_ORIGIN) {
        return;
    }

    createWindow(target.toString());
});

/**
 * A deliberately minimal menu: no File > New Window etc., so shortcuts
 * like Cmd+N, Cmd+1..5 and Cmd+Shift+G reach the app itself.
 */
function buildMenu() {
    Menu.setApplicationMenu(
        Menu.buildFromTemplate([
            {
                label: app.name,
                submenu: [
                    { role: 'about' },
                    { type: 'separator' },
                    { role: 'hide' },
                    { role: 'hideOthers' },
                    { role: 'unhide' },
                    { type: 'separator' },
                    { role: 'quit' },
                ],
            },
            {
                label: 'Edit',
                submenu: [
                    { role: 'undo' },
                    { role: 'redo' },
                    { type: 'separator' },
                    { role: 'cut' },
                    { role: 'copy' },
                    { role: 'paste' },
                    { role: 'selectAll' },
                ],
            },
            {
                label: 'View',
                submenu: [
                    {
                        label: 'Reload',
                        accelerator: 'CmdOrCtrl+R',
                        click: () =>
                            BrowserWindow.getFocusedWindow()?.webContents.reload(),
                    },
                    {
                        // ⌘⇧R belongs to voice recording in the app, so the
                        // conventional force-reload chord is shifted to ⌥.
                        label: 'Force Reload (Skip Cache)',
                        accelerator: 'CmdOrCtrl+Alt+R',
                        click: () =>
                            BrowserWindow.getFocusedWindow()?.webContents.reloadIgnoringCache(),
                    },
                    {
                        label: 'Clear Cache and Reload',
                        click: async () => {
                            const win = BrowserWindow.getFocusedWindow();
                            await win?.webContents.session.clearCache();
                            win?.webContents.reloadIgnoringCache();
                        },
                    },
                    { role: 'toggleDevTools' },
                    { type: 'separator' },
                    { role: 'resetZoom' },
                    { role: 'zoomIn' },
                    { role: 'zoomOut' },
                    { type: 'separator' },
                    { role: 'togglefullscreen' },
                ],
            },
            {
                label: 'Window',
                submenu: [
                    {
                        label: 'New Window',
                        accelerator: 'CmdOrCtrl+Alt+N',
                        click: () => createWindow(),
                    },
                    { type: 'separator' },
                    { role: 'minimize' },
                    { role: 'zoom' },
                    { role: 'close' },
                ],
            },
        ]),
    );
}

/**
 * Apple Calendar access goes through a small Swift helper (see eventkit/)
 * because EventKit has no Node binding. macOS attributes the calendar
 * permission prompt to this app; the usage string lives in Info.plist
 * (extendInfo in package.json for packaged builds).
 */
const EVENTKIT_HELPER = app.isPackaged
    ? path.join(process.resourcesPath, 'eventkit', 'donote-eventkit')
    : path.join(__dirname, 'eventkit', 'donote-eventkit');

function runEventKit(args) {
    return new Promise((resolve, reject) => {
        execFile(
            EVENTKIT_HELPER,
            args,
            { timeout: 120000, maxBuffer: 16 * 1024 * 1024 },
            (error, stdout) => {
                if (error) {
                    reject(error);

                    return;
                }

                try {
                    resolve(JSON.parse(stdout));
                } catch (parseError) {
                    reject(parseError);
                }
            },
        );
    });
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}T[0-9:.]+(Z|[+-]\d{2}:?\d{2})$/;

ipcMain.handle('apple-calendar:status', () => runEventKit(['status']));
ipcMain.handle('apple-calendar:request', () => runEventKit(['request']));
ipcMain.handle('apple-calendar:calendars', () => runEventKit(['calendars']));
ipcMain.handle('apple-calendar:events', (_event, from, to) => {
    if (
        typeof from !== 'string' ||
        typeof to !== 'string' ||
        !ISO_DATE.test(from) ||
        !ISO_DATE.test(to)
    ) {
        return Promise.reject(new Error('invalid date range'));
    }

    return runEventKit(['events', from, to]);
});

// donote://note/<id> deep links (KnowTabs "open in Donote", shared links).
// They resolve through the server's /n/<id> redirect, which picks the
// right team and view. A link arriving before the window exists is held
// until ready.
let pendingDeepLink = null;

function webUrlForDeepLink(rawUrl) {
    const match = /^donote:\/\/note\/([A-Za-z0-9-]+)/.exec(rawUrl);

    return match ? `${APP_URL}/n/${match[1]}` : null;
}

function openDeepLink(rawUrl) {
    const target = webUrlForDeepLink(rawUrl);

    if (!target) {
        return;
    }

    const win = primaryWindow();

    if (win) {
        win.loadURL(target);

        if (win.isMinimized()) {
            win.restore();
        }

        win.focus();
    } else {
        pendingDeepLink = target;
    }
}

app.setAsDefaultProtocolClient('donote');

app.on('open-url', (event, url) => {
    event.preventDefault();
    openDeepLink(url);
});

const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        const win = primaryWindow();

        if (win) {
            if (win.isMinimized()) {
                win.restore();
            }

            win.focus();
        }
    });

    app.whenReady().then(() => {
        buildMenu();

        // A deep link that arrived before launch decides the first window's
        // destination; otherwise open the app root.
        createWindow(pendingDeepLink ?? APP_URL);
        pendingDeepLink = null;

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });
}
