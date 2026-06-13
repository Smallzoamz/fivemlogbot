import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { spawn, exec } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = path.join(__dirname, '..');

let mainWindow;
const children = {
  api: null,
  bot: null,
  web: null
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1024,
    height: 768,
    title: 'FiveM Admin Desk Console',
    backgroundColor: '#0a0c10',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Spawns a child process and wires up stdout/stderr logging
function startService(serviceName, command, args, cwd) {
  if (children[serviceName]) {
    // Already running
    return;
  }

  console.log(`Starting ${serviceName} in ${cwd}...`);
  
  const child = spawn(command, args, {
    cwd: cwd,
    shell: true // Required for Windows commands like npm
  });

  children[serviceName] = child;

  child.stdout.on('data', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('log-update', { service: serviceName, data: data.toString() });
    }
  });

  child.stderr.on('data', (data) => {
    if (mainWindow) {
      mainWindow.webContents.send('log-update', { service: serviceName, data: data.toString() });
    }
  });

  child.on('close', (code) => {
    console.log(`${serviceName} stopped with code ${code}`);
    children[serviceName] = null;
    if (mainWindow) {
      mainWindow.webContents.send('status-update', { service: serviceName, status: 'stopped', code });
    }
  });

  // Notify UI that it started
  if (mainWindow) {
    mainWindow.webContents.send('status-update', { service: serviceName, status: 'running' });
  }
}

// Kill process and its child processes on Windows
function killService(serviceName) {
  const child = children[serviceName];
  if (!child) return;

  console.log(`Stopping ${serviceName}...`);
  if (process.platform === 'win32') {
    // Kill the whole process tree (cmd.exe + node.exe)
    exec(`taskkill /pid ${child.pid} /T /F`, (err) => {
      if (err) {
        console.error(`Failed to kill process tree for ${serviceName}:`, err.message);
      }
    });
  } else {
    child.kill('SIGINT');
  }
}

function startAllServices() {
  const backendDir = path.join(rootDir, 'backend');
  const botDir = path.join(rootDir, 'bot');
  const frontendDir = path.join(rootDir, 'frontend');

  // Start Express Backend
  startService('api', 'npm', ['start'], backendDir);
  
  // Start Discord Bot
  startService('bot', 'npm', ['start'], botDir);
  
  // Start Frontend Web Server (Vite)
  startService('web', 'npm', ['run', 'dev'], frontendDir);
}

function killAllServices() {
  Object.keys(children).forEach(service => {
    killService(service);
  });
}

// ELECTRON LIFECYCLE

app.whenReady().then(() => {
  createWindow();

  // Wait for window to load, then start services
  mainWindow.webContents.once('did-finish-load', () => {
    startAllServices();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// Clean up all running background processes when Electron quits
app.on('window-all-closed', () => {
  killAllServices();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('will-quit', () => {
  killAllServices();
});


// IPC HANDLERS

// Receive command (stdin input) from UI and send to child process
ipcMain.on('send-command', (event, { service, command }) => {
  const child = children[service];
  if (child && !child.killed) {
    try {
      child.stdin.write(command + '\n');
    } catch (err) {
      console.error(`Failed to write to stdin of ${service}:`, err.message);
    }
  }
});

// Request to restart a service
ipcMain.on('restart-service', (event, { service }) => {
  killService(service);
  
  // Wait a short duration for cleanup before restarting
  setTimeout(() => {
    const dirMap = {
      api: path.join(rootDir, 'backend'),
      bot: path.join(rootDir, 'bot'),
      web: path.join(rootDir, 'frontend')
    };
    
    const commandMap = {
      api: { cmd: 'npm', args: ['start'] },
      bot: { cmd: 'npm', args: ['start'] },
      web: { cmd: 'npm', args: ['run', 'dev'] }
    };

    const runInfo = commandMap[service];
    const cwd = dirMap[service];

    if (runInfo && cwd) {
      startService(service, runInfo.cmd, runInfo.args, cwd);
    }
  }, 1500);
});

// Request to stop a service
ipcMain.on('stop-service', (event, { service }) => {
  killService(service);
});

// Request to start a stopped service
ipcMain.on('start-service', (event, { service }) => {
  const dirMap = {
    api: path.join(rootDir, 'backend'),
    bot: path.join(rootDir, 'bot'),
    web: path.join(rootDir, 'frontend')
  };
  
  const commandMap = {
    api: { cmd: 'npm', args: ['start'] },
    bot: { cmd: 'npm', args: ['start'] },
    web: { cmd: 'npm', args: ['run', 'dev'] }
  };

  const runInfo = commandMap[service];
  const cwd = dirMap[service];

  if (runInfo && cwd) {
    startService(service, runInfo.cmd, runInfo.args, cwd);
  }
});

// Query active statuses on UI load
ipcMain.on('query-statuses', (event) => {
  Object.keys(children).forEach(service => {
    const status = children[service] ? 'running' : 'stopped';
    event.reply('status-update', { service, status });
  });
});
