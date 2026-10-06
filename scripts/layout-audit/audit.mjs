// PicklePoint layout audit — every scenario x every device profile.
// usage: node audit.mjs [base=http://localhost:4600] [--shots]
import { chromium } from 'playwright'
import fs from 'fs'
import path from 'path'

const BASE = process.argv.find(a => a.startsWith('http')) || 'http://localhost:4600'
const SHOTS = process.argv.includes('--shots')
const ONLY = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7)
const OUT = process.env.OUT || '/tmp/audit'
const FS = process.env.FONTS || '/home/claude/audit/app/node_modules/@fontsource'
const FONT = {
  'bc-500': `${FS}/barlow-condensed/files/barlow-condensed-latin-500-normal.woff2`,
  'bc-600': `${FS}/barlow-condensed/files/barlow-condensed-latin-600-normal.woff2`,
  'bc-700': `${FS}/barlow-condensed/files/barlow-condensed-latin-700-normal.woff2`,
  'cz-600': `${FS}/cinzel/files/cinzel-latin-600-normal.woff2`,
  'cz-700': `${FS}/cinzel/files/cinzel-latin-700-normal.woff2`,
  'cz-900': `${FS}/cinzel/files/cinzel-latin-900-normal.woff2`,
}
const FONT_CSS = Object.keys(FONT).map(k => {
  const [f, w] = k.split('-')
  return `@font-face{font-family:'${f === 'bc' ? 'Barlow Condensed' : 'Cinzel'}';font-weight:${w};font-display:block;src:url(https://fonts.gstatic.com/pp/${k}.woff2) format('woff2')}`
}).join('\n')

// ------------------------------------------------------------ profiles
const P = (name, w, h, kind, dsf = 2) => ({ name, w, h, kind, dsf,
  touch: kind !== 'desktop', mobile: kind === 'phone' || kind === 'tablet' })
const PROFILES = [
  P('iphone-se', 375, 667, 'phone'), P('iphone-15', 390, 844, 'phone', 3), P('iphone-max', 430, 932, 'phone', 3),
  P('iphone-se-l', 667, 375, 'phone'), P('iphone-15-l', 844, 390, 'phone', 3), P('iphone-max-l', 932, 430, 'phone', 3),
  P('android-s', 360, 800, 'phone', 3), P('android-pixel', 412, 915, 'phone', 2.6),
  P('android-s-l', 800, 360, 'phone', 3), P('android-pixel-l', 915, 412, 'phone', 2.6),
  P('ipad-mini', 744, 1133, 'tablet'), P('ipad', 768, 1024, 'tablet'), P('ipad-air', 820, 1180, 'tablet'),
  P('ipad-pro11', 834, 1194, 'tablet'), P('ipad-pro13', 1024, 1366, 'tablet'),
  P('ipad-mini-l', 1133, 744, 'tablet'), P('ipad-l', 1024, 768, 'tablet'), P('ipad-air-l', 1180, 820, 'tablet'),
  P('ipad-pro11-l', 1194, 834, 'tablet'), P('ipad-pro13-l', 1366, 1024, 'tablet'),
  P('atab-s', 601, 962, 'tablet'), P('atab', 800, 1280, 'tablet'), P('atab-s-l', 962, 601, 'tablet'), P('atab-l', 1280, 800, 'tablet'),
  P('desk-1024', 1024, 768, 'desktop', 1), P('desk-1280', 1280, 720, 'desktop', 1), P('desk-1366', 1366, 768, 'desktop', 1),
  P('desk-1440', 1440, 900, 'desktop', 1), P('desk-1920', 1920, 1080, 'desktop', 1),
  P('edge-639', 639, 900, 'desktop', 1), P('edge-640', 640, 900, 'desktop', 1), P('edge-767', 767, 900, 'desktop', 1),
  P('edge-1023', 1023, 800, 'desktop', 1), P('edge-1279', 1279, 800, 'desktop', 1),
]
const SHOT_PROFILES = new Set(['iphone-se', 'iphone-15', 'ipad-air', 'ipad-l', 'desk-1440', 'desk-1920', 'android-s-l'])

// ------------------------------------------------------------ helpers
const vis = (page, sel, text) => page.locator(`${sel}:visible`, { hasText: text }).first()
const btn = (text) => async p => { await vis(p, 'button', text).click(); await p.waitForTimeout(250) }
const tab = (t) => btn(new RegExp(`^${t}$`, 'i'))
const seq = (...fns) => async p => { for (const f of fns) await f(p) }
const keypad = (digits) => async p => { for (const d of digits) await vis(p, 'button', new RegExp(`^${d}$`)).click() ; await p.waitForTimeout(400) }
const ycAdmin = (code) => ({ [`pp.admin.${code}`]: JSON.stringify({ t: 'mock', exp: Date.now() + 36e5 }) })
const tv = (pane) => seq(async p => { await p.getByRole('button', { name: /^TV( mode)?$/ }).first().click(); await p.waitForTimeout(300) }, ...(pane ? [btn(new RegExp(`^${pane}$`))] : []))
const wizard = async p => {
  for (let i = 0; i < 6; i++) {
    for (const el of await p.locator('input[type=text]:visible, input:not([type]):visible, textarea:visible').all()) {
      if (!(await el.inputValue())) await el.fill(i === 0 ? 'Persatuan Pickleball Bandar Puchong Jaya Terbuka 2026' : 'Kelab Sukan Seri Kembangan United Elite\nq\n蒲种匹克球俱乐部精英队\nt')
    }
    const next = p.locator('button:visible', { hasText: 'Next' }).first()
    if (!(await next.count()) || await next.isDisabled()) break
    await next.click(); await p.waitForTimeout(200)
  }
}

// name, path, steps, { ls, tvOnly, notPortraitPhone }
const S = (name, path, steps, o = {}) => ({ name, path, steps, ...o })
const SCENARIOS = [
  S('join', '/'),
  S('quick-setup', '/quick'),
  S('quick-play', '/quick', btn('START')),
  S('new-wizard', '/new', wizard),
  S('owner', '/owner'),
  S('pk-live', '/c/PICKLE'),
  S('pk-matches', '/c/PICKLE', tab('matches')),
  S('pk-tv', '/c/PICKLE', tv(), { tvOnly: true }),
  S('pk-court-gate', '/c/PICKLE/court/1'),
  S('pk-court', '/c/PICKLE/court/1', keypad('0001')),
  S('pk-match', '/c/PICKLE', seq(tab('matches'), async p => { await p.locator('a[href*="/match/"]:visible').first().click(); await p.waitForTimeout(400) })),
  S('pk-admin-gate', '/c/PICKLE/admin'),
  ...['competition', 'scoring', 'teams', 'courts', 'schedule'].map(t =>
    S(`pk-admin-${t}`, '/c/PICKLE/admin', seq(keypad('9999'), tab(t)))),
  S('yc-gate', '/c/YC2626'),
  ...['live', 'matches', 'standings', 'knockout'].flatMap(t => [
    S(`yc-pb-${t}`, '/c/YC2626?s=pickleball', tab(t)),
    S(`yc-all-${t}`, '/c/YC2626?s=all', tab(t)),
  ]),
  S('yc-tv-all', '/c/YC2626?s=all', tv(), { tvOnly: true }),
  S('yc-tv-tables', '/c/YC2626?s=all', tv('Tables'), { tvOnly: true }),
  S('sf-ko-bm', '/c/YCSF?s=badminton', tab('knockout')),
  S('sf-ko-all', '/c/YCSF?s=all', tab('knockout')),
  S('sf-tv-bracket', '/c/YCSF?s=all', tv('Bracket'), { tvOnly: true }),
  S('fin-live', '/c/YCFIN?s=pickleball'),
  S('fin-matches', '/c/YCFIN?s=badminton', tab('matches')),
  S('fin-tv', '/c/YCFIN?s=all', tv(), { tvOnly: true }),
  S('win-ko', '/c/YCWIN?s=pickleball', tab('knockout')),
  S('win-ko-all', '/c/YCWIN?s=all', tab('knockout')),
  S('win-live-all', '/c/YCWIN?s=all'),
  S('win-tv-all', '/c/YCWIN?s=all', tv(), { tvOnly: true }),
  S('win-tv-one', '/c/YCWIN?s=badminton', tv(), { tvOnly: true }),
  S('yc-court', '/c/YC2626/court/1', keypad('1234')),
  ...['competition', 'scoring', 'teams', 'courts', 'schedule', 'knockout', 'sports'].map(t =>
    S(`yc-admin-${t}`, '/c/YC2626/admin', tab(t), { ls: ycAdmin('YC2626') })),
  S('yc-admin-schedule-bm', '/c/YC2626/admin', seq(tab('schedule'), btn('Badminton')), { ls: ycAdmin('YC2626') }),
  S('sf-admin-knockout', '/c/YCSF/admin', tab('knockout'), { ls: ycAdmin('YCSF') }),
  S('win-admin-knockout', '/c/YCWIN/admin', tab('knockout'), { ls: ycAdmin('YCWIN') }),
  // MCMD / MCXD (migration 0026 groups_ko opt-ins) — sandbox fixtures in mockmc.ts
  S('mc-live', '/c/MCMD'),
  S('mc-matches', '/c/MCMD', tab('matches')),
  S('mc-matches-open', '/c/MCMD', seq(tab('matches'), btn(/show games/))),
  S('mc-bracket-preview', '/c/MCMD', tab('bracket')),
  S('mc-match', '/c/MCMD', seq(tab('matches'), btn(/show games/), async p => { await p.locator('a[href*="/match/"]:visible').first().click(); await p.waitForTimeout(400) })),
  S('mc-ko-live', '/c/MCKO'),
  S('mc-ko-bracket', '/c/MCKO', tab('bracket')),
  S('mc-ko-matches', '/c/MCKO', tab('matches')),
  S('mc-tv-live', '/tv/MCMD+MCXD', btn(/^live$/), { tvOnly: true }),
  S('mc-tv-groups', '/tv/MCMD+MCXD', btn(/^groups$/), { tvOnly: true }),
  S('mc-tv-bracket-pre', '/tv/MCMD+MCXD', btn(/^bracket$/), { tvOnly: true }),
  S('mc-tv-ko', '/tv/MCKO+MCKX', btn(/^bracket$/), { tvOnly: true }),
  S('mc-tv-ko-live', '/tv/MCKO+MCKX', btn(/^live$/), { tvOnly: true }),
  S('mc-tv-win', '/tv/MCWIN+MCKX', btn(/^bracket$/), { tvOnly: true }),
  ...['scoring', 'teams', 'schedule', 'bracket'].map(t =>
    S(`mc-admin-${t}`, '/c/MCMD/admin', tab(t), { ls: ycAdmin('MCMD') })),
  S('mc-admin-toss', '/c/MCTIE/admin', tab('bracket'), { ls: ycAdmin('MCTIE') }),
  S('mc-admin-draw', '/c/MCNEW/admin', seq(tab('teams'), btn(/GENERATE RANDOM GROUPS/)), { ls: ycAdmin('MCNEW') }),
]

// ------------------------------------------------------------ in-page audit
function inPage(vw) {
  const out = { overflow: 0, offscreen: [], wraps: [], cut: [], squeezed: [], ragged: [], small: 0, smallEx: [] }
  const seen = (el) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
  const desc = (el) => {
    let s = el.tagName.toLowerCase()
    const c = typeof el.className === 'string' ? el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
    if (c) s += '.' + c
    const t = (el.innerText || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 28)
    return s + (t ? ` "${t}"` : '')
  }
  const de = document.documentElement
  if (de.scrollWidth > vw + 1) out.overflow = de.scrollWidth
  const clip = (el) => {
    let l = -Infinity, r = Infinity
    for (let a = el.parentElement; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a)
      if (/(auto|scroll|hidden|clip)/.test(cs.overflowX)) {
        const ar = a.getBoundingClientRect(); l = Math.max(l, ar.left); r = Math.min(r, ar.right)
      }
    }
    return { l, r }
  }
  const all = [...document.body.querySelectorAll('*')].filter(el => !el.closest('svg') || el.tagName.toLowerCase() === 'svg')
  const off = []
  for (const el of all) {
    if (!seen(el)) continue
    const r = el.getBoundingClientRect()
    if (!r.width || !r.height) continue
    if (r.right > vw + 1 || r.left < -1) {
      const c = clip(el)
      if (c.l >= -1 && c.r <= vw + 1) continue
      off.push(el)
    }
  }
  const offSet = new Set(off)
  for (const el of off) {
    let a = el.parentElement, nested = false
    while (a) { if (offSet.has(a)) { nested = true; break } a = a.parentElement }
    if (!nested) { const r = el.getBoundingClientRect(); out.offscreen.push(`${desc(el)} [${Math.round(r.left)}..${Math.round(r.right)}]`) }
  }
  // short text that wrapped onto 2+ lines
  const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (tw.nextNode()) {
    const n = tw.currentNode, t = n.textContent.replace(/\s+/g, ' ').trim()
    if (!t) continue
    const host = n.parentElement
    if (!host || host.closest('svg') || !seen(host) || host.closest('[class*="line-clamp"]')) continue
    if (t.length > (host.closest('button,a,th,label') ? 42 : 30)) continue
    const rg = document.createRange(); rg.selectNodeContents(n)
    const tops = new Set([...rg.getClientRects()].filter(x => x.width > 1).map(x => Math.round(x.top / 4)))
    if (tops.size > 1) out.wraps.push(`"${t}" in ${desc(host)} w=${Math.round(host.getBoundingClientRect().width)}`)
  }
  // cut-off form values
  for (const el of document.querySelectorAll('input,textarea,select')) {
    if (!seen(el)) continue
    if ((el.value || '').length && el.scrollWidth > el.clientWidth + 2 && el.tagName !== 'TEXTAREA') out.cut.push(`${desc(el)} "${String(el.value).slice(0, 24)}"`)
  }
  // ellipsis squeezed to almost nothing
  for (const el of all) {
    if (!seen(el)) continue
    const cs = getComputedStyle(el)
    if (cs.textOverflow !== 'ellipsis' || cs.overflowX === 'visible') continue
    if (el.scrollWidth > el.clientWidth + 1 && el.clientWidth < 40 && (el.textContent || '').trim().length > 3) {
      out.squeezed.push(`${desc(el)} shows ${el.clientWidth}px of ${el.scrollWidth}px`)
    }
  }
  // ragged columns: sibling rows with the same structure whose cells don't line up
  for (const list of all) {
    if (!seen(list)) continue
    const rows = [...list.children].filter(c => seen(c) && c.children.length >= 3)
    if (rows.length < 3) continue
    const sig = (r) => r.className + '|' + [...r.children].map(c => c.tagName + (typeof c.className === 'string' ? c.className : '')).join(',')
    const groups = new Map()
    // rows of one column only (a 2-column card grid is two lists, not one)
    for (const r of rows) { const k = sig(r) + '@' + Math.round(r.getBoundingClientRect().left); groups.set(k, [...(groups.get(k) || []), r]) }
    for (const g of groups.values()) {
      if (g.length < 3) continue
      const tops = g.map(r => r.getBoundingClientRect().top)
      if (new Set(tops.map(t => Math.round(t))).size < g.length) continue   // side-by-side cards, not rows
      const n = g[0].children.length
      for (let i = 1; i < n; i++) {
        const ls = g.map(r => r.children[i].getBoundingClientRect().left)
        const ws = g.map(r => r.children[i].getBoundingClientRect().width)
        if (ws.some(w => w === 0)) continue
        const spread = Math.max(...ls) - Math.min(...ls)
        if (spread > 3) {
          out.ragged.push(`${desc(list)} col ${i} drifts ${Math.round(spread)}px over ${g.length} rows`)
          break
        }
      }
    }
  }
  // small tap targets
  for (const el of document.querySelectorAll('button,a,select,input[type=checkbox]')) {
    if (!seen(el) || el.disabled) continue
    const r = el.getBoundingClientRect()
    if (r.width && r.height && (r.width < 30 || r.height < 30)) { out.small++; if (out.smallEx.length < 4) out.smallEx.push(`${desc(el)} ${Math.round(r.width)}x${Math.round(r.height)}`) }
  }
  return out
}

// ------------------------------------------------------------ runner
fs.mkdirSync(OUT, { recursive: true })
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--disable-background-networking', '--disable-component-update', '--disable-features=AutofillServerCommunication,OptimizationHints'] })
const results = []
async function runProfile(pr) {
  const ctx = await browser.newContext({
    viewport: { width: pr.w, height: pr.h }, deviceScaleFactor: pr.dsf, isMobile: pr.mobile, hasTouch: pr.touch,
    reducedMotion: 'reduce',
  })
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: FONT_CSS }))
  await ctx.route('https://fonts.gstatic.com/pp/*', r => {
    const k = path.basename(new URL(r.request().url()).pathname, '.woff2')
    return r.fulfill({ contentType: 'font/woff2', body: fs.readFileSync(FONT[k]) })
  })
  await ctx.route(/^https?:\/\/(?!localhost)/, r => r.abort())
  const portraitPhone = pr.kind === 'phone' && pr.h > pr.w
  for (const sc of SCENARIOS) {
    if (ONLY && !ONLY.split(',').some(o => sc.name.startsWith(o))) continue
    if (sc.tvOnly && pr.h > pr.w) continue
    const page = await ctx.newPage()
    page.setDefaultTimeout(4000)
    const errs = []
    page.on('pageerror', e => errs.push(e.message))
    page.on('console', m => { if (m.type() === 'error') errs.push(m.text().slice(0, 120)) })
    let res
    try {
      await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
      await page.evaluate(ls => { localStorage.clear(); for (const [k, v] of Object.entries(ls || {})) localStorage.setItem(k, v) }, sc.ls)
      await page.goto(BASE + sc.path, { waitUntil: 'load' })
      await page.waitForTimeout(350)
      if (sc.steps) await sc.steps(page)
      await page.evaluate(() => document.fonts.ready)
      await page.waitForTimeout(250)
      res = await page.evaluate(inPage, pr.w)
      if (SHOTS && SHOT_PROFILES.has(pr.name)) {
        fs.mkdirSync(`${OUT}/shots/${pr.name}`, { recursive: true })
        await page.screenshot({ path: `${OUT}/shots/${pr.name}/${sc.name}.png`, fullPage: !sc.tvOnly, timeout: 30000 })
      }
    } catch (e) { res = { error: String(e.message).split('\n')[0] } }
    results.push({ profile: pr.name, scenario: sc.name, ...res, errs })
    fs.appendFileSync(`${OUT}/progress.log`, `${pr.name} ${sc.name} ${res.error ? 'ERR ' + res.error : 'ok'}\n`)
    await page.close()
  }
  await ctx.close()
}
const queue = [...PROFILES]
await Promise.all(Array.from({ length: 10 }, async () => { while (queue.length) await runProfile(queue.shift()) }))
await browser.close()
fs.writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 1))

// ------------------------------------------------------------ summary
const issues = r => (r.error ? 1 : 0) + (r.overflow ? 1 : 0) + (r.offscreen?.length || 0) + (r.wraps?.length || 0) +
  (r.cut?.length || 0) + (r.squeezed?.length || 0) + (r.ragged?.length || 0) + (r.errs?.length || 0)
const byProfile = {}
for (const r of results) byProfile[r.profile] = (byProfile[r.profile] || 0) + issues(r)
console.log('issues per profile:', JSON.stringify(byProfile))
const uniq = new Map()
for (const r of results) {
  for (const [k, list] of Object.entries({ error: r.error ? [r.error] : [], overflow: r.overflow ? [`page ${r.overflow}px`] : [], offscreen: r.offscreen || [], wrap: r.wraps || [], cut: r.cut || [], squeezed: r.squeezed || [], ragged: r.ragged || [], js: r.errs || [] })) {
    for (const m of list) {
      const key = `${r.scenario} | ${k} | ${m.replace(/\[\-?\d+\.\.\d+\]|w=\d+|\d+px/g, '#')}`
      const e = uniq.get(key) || { n: 0, profiles: [] }
      e.n++; if (e.profiles.length < 4) e.profiles.push(r.profile); uniq.set(key, e)
    }
  }
}
console.log(`\n${uniq.size} distinct issues (scenario | type | detail  x count [profiles])`)
for (const [k, v] of [...uniq].sort()) console.log(`${k}  x${v.n} [${v.profiles.join(',')}]`)
const small = results.reduce((a, r) => a + (r.small || 0), 0)
console.log(`\nsmall tap targets (<30px) total: ${small}`)
