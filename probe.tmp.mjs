import { chromium } from 'playwright'
const mod = await import('./scripts/harness/bridge-stub.mjs')
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(mod.installAppBridge, { scenario:'review', now: Date.now(), entra:true })
await page.goto('http://localhost:5180')
await page.getByRole('region', { name: 'Calendrier' }).waitFor()
await page.locator('li').filter({ hasText: 'Néovia Santé — cadrage renfort data' }).first().getByRole('button', { name: /Ouvrir/ }).click()
await page.getByRole('button', { name: 'Relire et valider' }).click()
await page.getByText('Prêt à envoyer').waitFor()
await page.waitForTimeout(900)
const doc = () => page.evaluate(() => { const d=document.querySelector('main.fade-below'); return d?{top:Math.round(d.scrollTop),client:d.clientHeight,scroll:d.scrollHeight}:null })
// first attack: read the transcript fully, come back
await page.getByRole('button', { name: 'Transcription', exact: true }).click()
await page.waitForTimeout(500)
for (let i=0;i<30;i++){ const done = await page.evaluate(()=>{const d=document.querySelector('main.fade-below'); if(!d||d.scrollTop+d.clientHeight>=d.scrollHeight-8) return true; d.scrollBy({top:d.clientHeight-64}); d.dispatchEvent(new Event('scroll')); return false}); await page.waitForTimeout(90); if(done)break }
await page.getByRole('button', { name: 'Lecture', exact: true }).click()
await page.waitForTimeout(400)
console.log('after first transcript read, back on Lecture:', await doc())
// second: open transcription and do not read it
await page.getByRole('button', { name: 'Transcription', exact: true }).click()
await page.waitForTimeout(60); console.log('placeholder:', await doc())
await page.waitForTimeout(900); console.log('loaded     :', await doc())
for (let i=0;i<20;i++){ const t=page.getByRole('button',{name:/ce qui part/}); if(await t.count()===0) break; await t.first().click(); await page.waitForTimeout(250) }
console.log('VALIDER:', await page.getByRole('button',{name:/^Valider/}).count()>0, await doc())
console.log('controls:', await page.evaluate(()=>[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>/Valider|suite|Remonter/.test(t))))
await browser.close()
