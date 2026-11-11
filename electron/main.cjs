const {app, BrowserWindow, ipcMain} = require('electron');
const {autoUpdater} = require('electron-updater');
const path = require('path');

function getWindowFromSender(event) {
	const window = BrowserWindow.fromWebContents(event.sender);
	if (!window || window.isDestroyed()) throw new Error('CORE ERP window is unavailable');
	return window;
}

ipcMain.handle('core-window:minimize', (event) => getWindowFromSender(event).minimize());
ipcMain.handle('core-window:toggle-maximize', (event) => {
	const window = getWindowFromSender(event);
	if (window.isMaximized()) window.unmaximize();
	else window.maximize();
	return window.isMaximized();
});
ipcMain.handle('core-window:toggle-fullscreen', (event) => {
	const window = getWindowFromSender(event);
	window.setFullScreen(!window.isFullScreen());
	return window.isFullScreen();
});
ipcMain.handle('core-window:close', (event) => getWindowFromSender(event).close());
ipcMain.handle('core-window:get-state', (event) => {
	const window = getWindowFromSender(event);
	return {maximized: window.isMaximized(), fullscreen: window.isFullScreen()};
});

function startAutoUpdater() {
	if (!app.isPackaged || process.env.DEV) return;

	autoUpdater.autoDownload = true;
	autoUpdater.autoInstallOnAppQuit = true;
	autoUpdater.allowPrerelease = false;
	autoUpdater.allowDowngrade = false;
	autoUpdater.on('checking-for-update', () => console.info('CORE ERP: checking for updates'));
	autoUpdater.on('update-available', (info) => console.info(`CORE ERP: update ${info.version} is available`));
	autoUpdater.on('update-not-available', (info) => console.info(`CORE ERP: CORE ERP is up to date (${info.version})`));
	autoUpdater.on('download-progress', (progress) => {
		console.info(`CORE ERP: update download ${Math.round(progress.percent)}%`);
	});
	autoUpdater.on('update-downloaded', (info) => {
		console.info(`CORE ERP: update ${info.version} downloaded; restarting to install`);
		autoUpdater.quitAndInstall();
	});
	autoUpdater.on('error', (error) => {
		console.error('CORE ERP: automatic update failed:', error);
	});

	autoUpdater.checkForUpdatesAndNotify().catch((error) => {
		console.error('CORE ERP: could not check for updates:', error);
	});
}

function showLoadError(window, message) {
	const escapedMessage = String(message).replace(/[&<>"']/g, (character) => ({
		'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
	})[character]);
	const html = `<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>CORE ERP</title>
		<style>body{margin:0;background:#0f172a;color:#e2e8f0;font:16px Segoe UI,sans-serif;display:grid;min-height:100vh;place-items:center}main{max-width:680px;padding:32px;border:1px solid #334155;border-radius:12px;background:#1e293b}h1{color:#38bdf8}pre{white-space:pre-wrap;color:#fda4af}</style>
		<main><h1>تعذر تشغيل CORE ERP</h1><p>لم يتم تحميل واجهة التطبيق. تأكد من نجاح البناء ثم أعد التشغيل.</p><pre>${escapedMessage}</pre></main></html>`;
	window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
	window.show();
}

function createWindow() {
	const window = new BrowserWindow({
		width: 1400,
		height: 900,
		minWidth: 1000,
		minHeight: 680,
		frame: false,
		titleBarStyle: 'hidden',
		titleBarOverlay: false,
		resizable: true,
		roundedCorners: true,
		backgroundMaterial: 'mica',
		show: false,
		backgroundColor: '#0F172A',
		autoHideMenuBar: true,
		webPreferences: {
			preload: path.join(__dirname, 'preload.cjs'),
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
		},
	});
	const notifyWindowState = () => {
		if (!window.isDestroyed()) {
			window.webContents.send('core-window:state-changed', {
				maximized: window.isMaximized(),
				fullscreen: window.isFullScreen(),
			});
		}
	};
	window.on('maximize', notifyWindowState);
	window.on('unmaximize', notifyWindowState);
	window.on('enter-full-screen', notifyWindowState);
	window.on('leave-full-screen', notifyWindowState);
	window.once('ready-to-show', () => window.show());
	window.webContents.on('did-fail-load', (_event, code, description, validatedURL, isMainFrame) => {
		if (isMainFrame && code !== -3) {
			console.error(`CORE ERP failed to load ${validatedURL}: ${description} (${code})`);
			showLoadError(window, `${description} (${code})\n${validatedURL}`);
		}
	});
	window.webContents.on('render-process-gone', (_event, details) => {
		console.error('CORE ERP renderer exited:', details);
		showLoadError(window, `Renderer exited: ${details.reason}`);
	});

	const loading = process.env.DEV
		? window.loadURL('http://localhost:5173')
		: window.loadFile(path.join(__dirname, '../dist/index.html'));
	loading.catch((error) => {
		console.error('CORE ERP window load failed:', error);
		showLoadError(window, error.message);
	});
	return window;
}

app.whenReady().then(() => {
	createWindow();
	startAutoUpdater();
}).catch((error) => {
	console.error('CORE ERP startup failed:', error);
});
app.on('window-all-closed', () => app.quit());
