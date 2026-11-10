import { chromium } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const icon = await readFile(new URL('../public/mark.svg', import.meta.url), 'utf8')
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE })
try {
  for (const [name, size, maskable] of [['apple-touch-icon',180,true],['icon-192',192,false],['icon-512',512,false],['icon-maskable',512,true]]) {
    const page = await browser.newPage({ viewport: { width: size, height: size } })
    const svg = maskable ? icon.replace('<g fill=', '<g transform="translate(4.8 4.8) scale(.85)" fill=') : icon
    await page.setContent(`<style>body{margin:0;background:${maskable ? '#174c3c' : 'transparent'}}svg{width:100vw;height:100vh;display:block}</style>${svg}`)
    await page.screenshot({ path: fileURLToPath(new URL(`../public/${name}.png`, import.meta.url)), omitBackground: !maskable })
    await page.close()
  }
} finally {
  await browser.close()
}
