const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

if (process.env.TT_PROFILE) {
  app.setPath('userData', path.join(app.getPath('appData'), 'tempterm2-' + process.env.TT_PROFILE));
}

const SIZES = {
  '800x600': [800, 600],
  '1024x768': [1024, 768],
  '1280x720': [1280, 720],
};

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    backgroundColor: '#0c0c0c',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('index.html');
}

ipcMain.handle('set-window-size', (event, key) => {
  const size = SIZES[key];
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!size || !win) return;
  win.setResizable(true);
  win.setSize(size[0], size[1]);
  win.center();
  win.setResizable(false);
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());