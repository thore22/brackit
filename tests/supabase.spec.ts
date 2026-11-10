import { expect, test } from '@playwright/test'

const email = process.env.TEST_ADMIN_EMAIL
const password = process.env.TEST_ADMIN_PASSWORD
test.skip(!process.env.TEST_BASE_URL || !email || !password, 'Verbundene Testinstanz und Admin-Konto erforderlich')

test('Supabase Auth, Feld-QR und echte Realtime-Updates in getrennten Browser-Kontexten', async ({ page, browser }) => {
  await page.goto('/neu')
  await page.getByLabel('E-Mail').fill(email!)
  await page.getByLabel('Passwort').fill(password!)
  await page.getByRole('button', { name: 'Anmelden' }).click()
  await page.getByRole('button', { name: 'Vorlage laden' }).click()
  const name = `Realtime-Test ${new Date().toISOString()}`
  await page.getByLabel('Turniername').fill(name)
  await page.getByRole('button', { name: /9 Plan erzeugen/ }).click()
  await page.getByRole('button', { name: 'Spielplan generieren' }).click()
  await page.getByRole('button', { name: 'Weiter' }).click()
  await page.getByRole('button', { name: 'Veröffentlichen', exact: true }).click()
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible()
  const id = page.url().split('/').at(-1)
  await page.getByRole('link', { name: 'QR-Codes', exact: true }).click()
  await page.getByRole('button', { name: 'Feld-QR anlegen' }).first().click()
  const field = page.locator('.qr-card').filter({ hasText: 'Dauerhafter Feld-QR' }).first()
  const pin = await field.locator('.qr-pin strong').innerText()
  const href = (await field.getByRole('link', { name: 'Öffnen' }).getAttribute('href'))!
  const spectatorContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const refereeContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  try {
    const spectator = await spectatorContext.newPage()
    const referee = await refereeContext.newPage()
    await spectator.goto(new URL(`/t/${id}/live`, page.url()).href)
    await referee.goto(href)
    await expect(referee.getByText(/Die Turnierleitung startet das nächste Spiel/)).toBeVisible()
    await expect(spectator.getByText(/Echtzeitverbindung wird aufgebaut/)).toHaveCount(0)
    await page.goto(new URL(`/admin/${id}/spiel/1`, page.url()).href)
    await expect(page.getByText(/Echtzeitverbindung wird aufgebaut/)).toHaveCount(0)
    await page.getByRole('button', { name: 'Spiel starten' }).click()
    await expect(spectator.getByText('0 : 0', { exact: true })).toBeVisible({ timeout: 7000 })
    await referee.getByLabel('Feld-PIN').fill(pin)
    await referee.getByRole('button', { name: 'Zugang freischalten' }).click()
    await referee.getByRole('spinbutton', { name: 'Punkte Team 01' }).fill('24')
    await referee.getByRole('spinbutton', { name: 'Punkte Team 04' }).fill('19')
    await referee.getByRole('button', { name: 'Live-Stand aktualisieren' }).click()
    await expect(spectator.getByText('24 : 19', { exact: true })).toBeVisible({ timeout: 7000 })
    await referee.getByRole('button', { name: 'Ergebnis einreichen' }).click()
    await expect(page.getByRole('button', { name: 'Ergebnis bestätigen' })).toBeVisible({ timeout: 7000 })
    await page.getByRole('button', { name: 'Ergebnis bestätigen' }).click()
    await expect(referee.getByText('Das offizielle Ergebnis ist bestätigt.')).toBeVisible({ timeout: 7000 })
    await spectator.getByRole('button', { name: 'Tabellen', exact: true }).click()
    await expect(spectator.getByRole('row', { name: /1 Team 01 1 1 0 2/ })).toBeVisible()
  } finally {
    await spectatorContext.close()
    await refereeContext.close()
  }
})
