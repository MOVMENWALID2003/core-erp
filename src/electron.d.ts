interface CoreDesktopState {
  maximized: boolean;
  fullscreen: boolean;
}

interface CoreDesktopBridge {
  isElectron: true;
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<boolean>;
  toggleFullscreen: () => Promise<boolean>;
  close: () => Promise<void>;
  getState: () => Promise<CoreDesktopState>;
  onStateChanged: (callback: (state: CoreDesktopState) => void) => () => void;
}

interface Window {
  coreDesktop?: CoreDesktopBridge;
}
