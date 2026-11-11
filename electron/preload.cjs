const {contextBridge, ipcRenderer} = require('electron');

contextBridge.exposeInMainWorld('coreDesktop', {
	isElectron: true,
	minimize: () => ipcRenderer.invoke('core-window:minimize'),
	toggleMaximize: () => ipcRenderer.invoke('core-window:toggle-maximize'),
	toggleFullscreen: () => ipcRenderer.invoke('core-window:toggle-fullscreen'),
	close: () => ipcRenderer.invoke('core-window:close'),
	getState: () => ipcRenderer.invoke('core-window:get-state'),
	onStateChanged: (callback) => {
		const listener = (_event, state) => callback(state);
		ipcRenderer.on('core-window:state-changed', listener);
		return () => ipcRenderer.removeListener('core-window:state-changed', listener);
	},
});
