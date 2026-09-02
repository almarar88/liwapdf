// Runs the built test bundle inside a real Electron renderer and prints one
// line per check. Exit code 1 when anything fails, so CI goes red.
const { app, BrowserWindow } = require('electron')
const path = require('node:path')
const fs = require('node:fs')

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    show: false,
    width: 1200,
    height: 900,
    // TEST_SANDBOX=1 runs the suites under the same OS sandbox as the app's
    // own window, which is where font loading behaves differently.
    webPreferences: { sandbox: process.env.TEST_SANDBOX === '1', contextIsolation: true, webSecurity: false }
  })
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 2 && !/Security Warning|willReadFrequently/.test(String(message))) console.log('CONSOLE', String(message).slice(0, 400))
  })
  await win.loadFile(path.join(process.cwd(), 'out/tests/tests/index.html'))
  const started = Date.now()
  while (Date.now() - started < 240000) {
    await new Promise((r) => setTimeout(r, 1000))
    if (await win.webContents.executeJavaScript('window.__done === true')) break
  }
  const results = JSON.parse(await win.webContents.executeJavaScript('JSON.stringify(window.__results ?? [])'))
  const artifacts = JSON.parse(await win.webContents.executeJavaScript('JSON.stringify(window.__artifacts ?? {})'))
  const artifactDir = path.join(process.cwd(), 'out/tests/artifacts')
  fs.mkdirSync(artifactDir, { recursive: true })
  for (const [name, base64] of Object.entries(artifacts)) fs.writeFileSync(path.join(artifactDir, name), Buffer.from(base64, 'base64'))
  let failed = 0
  for (const result of results) {
    if (result.ok) console.log(`PASS  ${result.suite} › ${result.name}`)
    else {
      failed += 1
      console.log(`FAIL  ${result.suite} › ${result.name}\n      ${String(result.detail ?? '').slice(0, 600)}`)
    }
  }
  console.log(`\n${results.length - failed} passed, ${failed} failed, ${results.length} total`)
  app.exit(failed > 0 || results.length === 0 ? 1 : 0)
})
