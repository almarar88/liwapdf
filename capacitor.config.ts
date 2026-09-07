import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'app.alcode.editor',
  appName: 'Alcode Editor',
  webDir: 'out/mobile',
  android: {
    // The app works on files the user picked; mixed content is never needed.
    allowMixedContent: false,
    // Large documents are held in memory while a tool runs.
    webContentsDebuggingEnabled: false
  },
  plugins: {
    StatusBar: { overlaysWebView: false },
    Keyboard: { resizeOnFullScreen: true }
  }
}

export default config
