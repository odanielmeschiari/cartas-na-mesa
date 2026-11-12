import { test } from '@playwright/test';

// Fluxos reais de sala e partida entram no passo 6 (gate do spike).
test.skip('smoke', async ({ page }) => {
  await page.goto('/');
});
