// preload.js

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  runAnalysis: async (args) => ipcRenderer.invoke('run-analysis', args),
  stopAnalysis: () => ipcRenderer.send('stop-analysis'),
  onProgressUpdate: (callback) => ipcRenderer.on('progress-update', callback),
  onAnalysisStopped: (callback) => ipcRenderer.on('analysis-stopped', callback)
});
