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

let mainWindow = null;

function createWindow() {
    mainWindow = new BrowserWindow({
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

    // target=_blank links (Google Calendar events, external URLs) open in
    // the system browser; everything else stays in the shell.
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);

        return { action: 'deny' };
    });

    mainWindow.webContents.on('did-fail-load', (_event, code, description) => {
        if (code !== -3) {
            mainWindow.loadFile(path.join(__dirname, 'offline.html'), {
                query: { url: APP_URL, error: description },
            });
        }
    });

    // Voice memos ask for getDisplayMedia purely to mix system audio
    // (Meet/Preply participants on speakers or AirPods) with the mic.
    // 'loopback' captures system output via ScreenCaptureKit; the video
    // track is discarded by the renderer immediately.
    mainWindow.webContents.session.setDisplayMediaRequestHandler(
        (_request, callback) => {
            desktopCapturer
                .getSources({ types: ['screen'] })
                .then((sources) => {
                    callback({ video: sources[0], audio: 'loopback' });
                })
                .catch(() => callback({}));
        },
    );

    mainWindow.loadURL(APP_URL);

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

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
                        click: () => mainWindow?.webContents.reload(),
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
                submenu: [{ role: 'minimize' }, { role: 'zoom' }, { role: 'close' }],
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

const hasLock = app.requestSingleInstanceLock();

if (!hasLock) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }

            mainWindow.focus();
        }
    });

    app.whenReady().then(() => {
        buildMenu();
        createWindow();

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
