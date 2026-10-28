const { app, BrowserWindow, ipcMain, session, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const adminMode = process.argv.includes('--admin');

if (adminMode) {
  app.setPath('userData', path.join(app.getPath('appData'), 'tempterm2-admin'));
} else if (process.env.TT_PROFILE) {
  app.setPath('userData', path.join(app.getPath('appData'), 'tempterm2-' + process.env.TT_PROFILE));
}

const SIZES = {
  '800x600': [800, 600],
  '1024x768': [1024, 768],
  '1280x720': [1280, 720],
};

function createWindow() {
  const win = new BrowserWindow({
    width: adminMode ? 1000 : 800,
    height: adminMode ? 760 : 600,
    resizable: adminMode,
    backgroundColor: '#0c0c0c',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), backgroundThrottling: false },
  });
  win.loadFile(adminMode ? 'admin.html' : 'index.html');
}

ipcMain.handle('set-window-size', (event, key) => {
  if (adminMode) return;
  const size = SIZES[key];
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!size || !win) return;
  win.setResizable(true);
  win.setSize(size[0], size[1]);
  win.center();
  win.setResizable(false);
});

ipcMain.handle('is-dev', () => !app.isPackaged);

ipcMain.handle('reset-all', async event => {
  if (app.isPackaged) return;
  await session.defaultSession.clearStorageData();
  await session.defaultSession.clearCache();
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win) win.webContents.reloadIgnoringCache();
});

ipcMain.handle('pick-image', async event => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const res = await dialog.showOpenDialog(win, {
    title: 'Choose a picture',
    properties: ['openFile'],
    filters: [{ name: 'Pictures (png, jpeg)', extensions: ['png', 'jpg', 'jpeg'] }],
  });
  if (res.canceled || !res.filePaths[0]) return null;
  const file = res.filePaths[0];
  try {
    if (fs.statSync(file).size > 15 * 1024 * 1024) return { error: 'that picture is too big (15 MB max).' };
    return { name: path.basename(file), data: fs.readFileSync(file) };
  } catch (err) {
    return { error: 'could not open that file.' };
  }
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());