const { app, BrowserWindow } = require('electron');
const path = require('path');

if (process.env.TT_PROFILE) {
  app.setPath('userData', path.join(app.getPath('appData'), 'tempterm2-' + process.env.TT_PROFILE));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 800,
    height: 600,
    resizable: false,
    backgroundColor: '#0c0c0c',
    autoHideMenuBar: true,
  });
  win.loadFile('index.html');
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());