const { app, BrowserWindow, session, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');

const isDev = !app.isPackaged;
// electron-builder's portable NSIS build sets this env var when running the portable
// exe — that build has no fixed install location for an update to land in, so it's
// excluded from auto-update (the NSIS installer target is the one that gets updates).
const isPortable = !!process.env.PORTABLE_EXECUTABLE_DIR;
const devServerUrl = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 650,
    backgroundColor: '#0a0a0f', // matches the app's dark theme — avoids a white flash on load
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.once('ready-to-show', () => win.show());

  if (isDev) {
    win.loadURL(devServerUrl);
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

/**
 * Checks GitHub Releases on Will-83/NeonPlug (see package.json "build.publish") — never
 * upstream. Downloads silently in the background; once ready, asks whether to restart
 * now or install on next quit. Check failures (no internet, no releases published yet)
 * are logged rather than shown, so a fresh or offline install isn't greeted with a
 * scary error dialog on launch.
 */
function setupAutoUpdater() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('error', (err) => {
    console.error('Auto-update check failed:', err.message);
  });

  autoUpdater.on('update-downloaded', (info) => {
    const choice = dialog.showMessageBoxSync({
      type: 'info',
      title: 'Update ready',
      message: `NeonPlug ${info.version} has been downloaded.`,
      detail: 'Restart now to install it, or it will install automatically the next time you quit.',
      buttons: ['Restart Now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
    if (choice === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.checkForUpdates().catch((err) => {
    console.error('Auto-update check failed:', err.message);
  });
}

app.whenReady().then(() => {
  // Web Serial permission wiring — the app talks to the radio entirely through
  // navigator.serial (see src/radios/*/protocol.ts), unchanged from the browser version.
  // Electron implements the same Web Serial API but, unlike Chrome, has no built-in
  // port-picker UI — the app is responsible for resolving each select-serial-port request.
  const ses = session.defaultSession;

  ses.setPermissionCheckHandler((_webContents, permission) => permission === 'serial');

  ses.on('select-serial-port', (event, portList, _webContents, callback) => {
    event.preventDefault();

    if (portList.length === 0) {
      callback('');
      return;
    }
    if (portList.length === 1) {
      callback(portList[0].portId);
      return;
    }

    const labels = portList.map((p, i) => `${i + 1}. ${p.displayName || p.portName || p.portId}`);
    const choice = dialog.showMessageBoxSync({
      type: 'question',
      title: 'Select serial port',
      message: 'Multiple serial ports found — choose the radio/hotspot port:',
      buttons: [...labels, 'Cancel'],
      cancelId: labels.length,
      noLink: true,
    });
    callback(choice < labels.length ? portList[choice].portId : '');
  });

  createWindow();

  if (!isDev && !isPortable) {
    setupAutoUpdater();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
