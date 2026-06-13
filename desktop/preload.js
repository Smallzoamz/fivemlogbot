const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  onLogUpdate: (callback) => {
    ipcRenderer.on('log-update', (event, data) => callback(data));
  },
  onStatusUpdate: (callback) => {
    ipcRenderer.on('status-update', (event, data) => callback(data));
  },
  sendCommand: (service, command) => {
    ipcRenderer.send('send-command', { service, command });
  },
  restartService: (service) => {
    ipcRenderer.send('restart-service', { service });
  },
  stopService: (service) => {
    ipcRenderer.send('stop-service', { service });
  },
  startService: (service) => {
    ipcRenderer.send('start-service', { service });
  },
  queryStatuses: () => {
    ipcRenderer.send('query-statuses');
  }
});
