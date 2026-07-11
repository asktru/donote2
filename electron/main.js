const { app, BrowserWindow, Menu, shell } = require('electron');
const path = require('path');

/**
 * The Donote web app this shell wraps. Point it at your Herd URL in
 * development or your deployment in production:
 *   DONOTE_URL=https://notes.example.com npm start
 */
const APP_URL = process.env.DONOTE_URL || 'https://donote.test';

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
