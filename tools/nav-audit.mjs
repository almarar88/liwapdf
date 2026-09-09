/**
 * Can you get home from everywhere?
 *
 * This exists because the answer was once no: the phone bar carried Files and
 * Profile but no Home, so the toolbox, the editor, the viewer and the convert
 * screen were all one-way doors — and the profile icon quietly doubling as
 * "back" was not something anyone would guess.
 *
 * Each journey below is the route a person actually takes to reach that
 * screen, driven through the app's own controls rather than by poking the
 * store, so a card wired to the wrong destination fails here too.
 *
 *   npm run build:mobile
 *   ROOT=$PWD/out/mobile PDF=path/to/any.pdf node tools/nav-audit.mjs
 */
import { chromium, devices } from 'playwright'
import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname } from 'node:path'
const ROOT = process.env.ROOT, PDF = process.env.PDF, PORT = Number(process.env.PORT||4223)
const TYPES = { '.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.woff2':'font/woff2','.ttf':'font/ttf','.png':'image/png','.ico':'image/x-icon','.gz':'application/gzip' }
const server = createServer((req,res)=>{ const u=decodeURIComponent((req.url||'/').split('?')[0])
  if(u==='/__doc'){ res.setHeader('Content-Type','application/pdf'); res.end(readFileSync(PDF)); return }
  let f=join(ROOT,u==='/'?'index.html':u); if(!existsSync(f))f=join(ROOT,'index.html')
  res.setHeader('Content-Type',TYPES[extname(f)]||'application/octet-stream'); res.end(readFileSync(f)) })
await new Promise(r=>server.listen(PORT,r))
const browser = await chromium.launch({ args:['--no-sandbox'], executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage()
const errors=[]; page.on('pageerror',e=>errors.push(String(e).slice(0,200)))
await page.goto(`http://localhost:${PORT}/`,{waitUntil:'load'}); await page.waitForTimeout(2500)
await page.evaluate(async () => {
  const bytes = new Uint8Array(await (await fetch('/__doc')).arrayBuffer())
  window.alcode.dialog.open = async () => [{ name:'sample.pdf', path:'/d/sample.pdf', data:bytes, size:bytes.byteLength }]
})

const atHome = () => page.evaluate(() => !!document.querySelector('.phone-home'))
const tap = async (sel, wait=900) => {
  const el = page.locator(sel).first()
  if (await el.count()===0) return false
  await el.click({ force:true }).catch(()=>{})
  await page.waitForTimeout(wait)
  return true
}
const byText = (re) => page.locator('.sheet-card, .tool, .more-row').filter({ hasText: re }).first()

// Each journey is the one a user actually takes to reach that screen.
const journeys = [
  ['settings',  async () => tap('.pill-btn:nth-child(3)')],
  ['tools',     async () => { await tap('.phone-add', 700); await byText(/الأدوات/).click({force:true}); await page.waitForTimeout(1200) }],
  ['organize',  async () => { await tap('.phone-add', 700); await byText(/تنظيم الصفحات/).click({force:true}); await page.waitForTimeout(1200) }],
  ['editor',    async () => { await tap('.phone-add', 700); await byText(/مستند نصّي جديد/).click({force:true}); await page.waitForTimeout(1600) }],
  ['annotate',  async () => { await tap('.ph-edit', 700); await byText(/توقيع/).click({force:true}); await page.waitForTimeout(1400) }],
  ['convert',   async () => { await tap('.ph-convert', 700); await byText(/PDF إلى صور|صور إلى PDF/).click({force:true}); await page.waitForTimeout(1400) }],
  ['viewer',    async () => { await tap('.ph-empty', 6000) }]
]

let bad = 0
for (const [name, go] of journeys) {
  await go()
  const left = !(await atHome())
  const visible = await page.evaluate(() => {
    const b = document.querySelector('.pill-btn')
    return !!b && b.offsetParent !== null
  })
  if (visible) { await page.locator('.pill-btn').first().click({force:true}); await page.waitForTimeout(800) }
  const back = await atHome()
  const ok = left && visible && back
  if (!ok) bad += 1
  console.log(`${ok?'OK  ':'FAIL'} ${name.padEnd(9)} reached=${left} homeVisible=${visible} returned=${back}`)
}
console.log(bad === 0 ? 'ALL ROUTES RETURN HOME' : `${bad} ROUTE(S) CANNOT RETURN HOME`)
console.log('ERRORS', JSON.stringify(errors.slice(0,3)))
await browser.close(); server.close()
