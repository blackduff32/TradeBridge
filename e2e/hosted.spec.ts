import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('hosted demo saves across reloads, isolates visitors and keeps execution disabled', async ({ page, browser, baseURL }) => {
  const other = await browser.newContext({ baseURL }); const second = await other.newPage();
  try {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Bring both sides/ })).toBeVisible();
    await expect(page.getByText('Use a development access token')).toHaveCount(0);
    await expect(page.locator('meta[property="og:image"]')).toHaveAttribute('content', /\/social-preview\.png$/);
    expect((await page.request.get('/social-preview.png')).status()).toBe(200);
    expect((await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await page.getByRole('button', { name: 'Explore the 100-unit mismatch' }).click();
    await expect(page.getByText('100-unit quantity difference')).toBeVisible();
    await expect(page.getByText('Hosted demo', { exact: true })).toBeVisible();
    await expect(page.getByText('Import buyer source CSV')).toHaveCount(0);
    await page.getByRole('button', { name: 'Create proposal v2' }).click();
    await expect(page.getByText('Version 2 saved for review')).toBeVisible();
    await page.reload();
    await expect(page.getByRole('button', { name: 'Propose v3' })).toBeVisible();
    await expect(page.getByRole('cell', { name: '1,100', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Verify with World ID' }).first()).toBeDisabled();
    await expect(page.getByText('Not available in the hosted demo. World ID approval runs in the local app with a staging World ID app.').first()).toBeVisible();
    await expect(page.getByText('The hosted demo makes no model calls. Agent runs need a server-side OpenAI key in the local app.')).toBeVisible();
    await expect(page.getByText(/^Steps 3 and 4 do not run in the hosted demo/)).toBeVisible();
    await expect(page.getByText('Signed in as buyer agent')).toBeVisible();
    await page.getByRole('button', { name: 'Audit trail', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Proposal v2 created' })).toBeVisible();
    await second.goto('/'); await second.getByRole('button', { name: 'Explore the 100-unit mismatch' }).click();
    await expect(second.getByRole('button', { name: 'Create proposal v2' })).toBeVisible();
    await second.setViewportSize({ width: 390, height: 844 });
    expect(await second.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await new AxeBuilder({ page: second }).withTags(['wcag2a', 'wcag2aa']).analyze()).violations).toEqual([]);
    await second.screenshot({ path: 'test-results/hosted-mobile.png', fullPage: true, animations: 'disabled' });
  } finally {
    await page.request.delete('/api/session'); await second.request.delete('/api/session'); await other.close();
  }
});
