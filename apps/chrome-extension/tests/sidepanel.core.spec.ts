import { expect, test } from '@playwright/test';

import { mockDaemonSummarize } from './helpers/daemon-fixtures';
import {
  assertNoErrors,
  buildUiState,
  closeExtension,
  getBrowserFromProject,
  getExtensionUrl,
  getOpenPickerList,
  launchExtension,
  openExtensionPage,
  seedSettings,
  sendBgMessage,
  trackErrors,
  updateSettings,
  waitForPanelPort,
} from './helpers/extension-harness';
import { allowFirefoxExtensionTests } from './helpers/extension-test-config';
import { waitForChatEnabled, waitForSettingsHydratedHook } from './helpers/panel-hooks';

test.skip(
  ({ browserName }) => browserName === 'firefox' && !allowFirefoxExtensionTests,
  'Firefox extension tests are blocked by Playwright limitations. Set ALLOW_FIREFOX_EXTENSION_TESTS=1 to run.',
);

test('sidepanel loads without runtime errors', async ({ browserName: _browserName }, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await openExtensionPage(harness, 'sidepanel.html', '#title');
    await new Promise((resolve) => setTimeout(resolve, 500));
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel hides chat dock when chat is disabled', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, { chatEnabled: false });
    const page = await harness.context.newPage();
    trackErrors(page, harness.pageErrors, harness.consoleErrors);
    await page.addInitScript(() => {
      (
        window as typeof globalThis & { __summarizeTestHooks?: Record<string, unknown> }
      ).__summarizeTestHooks = {};
    });
    await page.goto(getExtensionUrl(harness, 'sidepanel.html'), { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#title');
    await waitForPanelPort(page);
    await waitForPanelPort(page);
    await expect(page.locator('#chatDock')).toBeHidden();
    await expect(page.locator('#chatContainer')).toBeHidden();
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel updates chat visibility when settings change', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, { chatEnabled: true });
    const page = await openExtensionPage(harness, 'sidepanel.html', '#title', () => {
      (window as typeof globalThis & { IntersectionObserver?: unknown }).IntersectionObserver =
        undefined;
    });
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await waitForChatEnabled(page, true);
    await expect(page.locator('#chatDock')).toBeVisible();

    await updateSettings(page, { chatEnabled: false });
    await waitForChatEnabled(page, false);
    await expect(page.locator('#chatDock')).toBeHidden();
    await expect(page.locator('#chatContainer')).toBeHidden();
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel scheme picker applies overlay selection', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    const page = await openExtensionPage(harness, 'sidepanel.html', '#title', () => {
      (
        window as typeof globalThis & { __summarizeTestHooks?: Record<string, unknown> }
      ).__summarizeTestHooks = {};
    });
    await waitForPanelPort(page);
    await page.evaluate(() => {
      const global = window as typeof globalThis & {
        __summarizePanelPort?: { disconnect?: () => void } | undefined;
      };
      global.__summarizePanelPort?.disconnect?.();
      global.__summarizePanelPort = undefined;
    });
    await page.click('#drawerToggle');
    await expect(page.locator('#drawer')).toBeVisible();

    const schemeLabel = page.locator('label.scheme');
    const schemeTrigger = schemeLabel.locator('.pickerTrigger');

    await schemeTrigger.focus();
    await schemeTrigger.press('Enter');
    const schemeList = getOpenPickerList(page);
    await expect(schemeList).toBeVisible();
    await schemeList.locator('[role="option"]').nth(1).click();

    await expect(schemeTrigger.locator('.scheme-label')).toHaveText('Cedar');
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel refresh free models from advanced settings', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, { autoSummarize: false, token: 'test-token' });

    let modelCalls = 0;
    await harness.context.route('http://127.0.0.1:8787/v1/models', async (route) => {
      modelCalls += 1;
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          options: [
            { id: 'auto', label: 'Auto' },
            { id: 'free', label: 'Free (OpenRouter)' },
          ],
          providers: {
            openrouter: true,
            openai: false,
            google: false,
            anthropic: false,
            xai: false,
            zai: false,
          },
          openaiBaseUrl: null,
          localModelsSource: null,
        }),
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await harness.context.route('http://127.0.0.1:8787/v1/refresh-free', async (route) => {
      await route.fulfill({
        body: JSON.stringify({ ok: true, id: 'refresh-1' }),
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    const sseBody = [
      'event: status',
      'data: {"text":"Refresh free: scanning..."}',
      '',
      'event: done',
      'data: {}',
      '',
    ].join('\n');

    await harness.context.route(
      'http://127.0.0.1:8787/v1/refresh-free/refresh-1/events',
      async (route) => {
        await route.fulfill({
          body: sseBody,
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        });
      },
    );

    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(page);
    await page.click('#drawerToggle');
    await expect(page.locator('#drawer')).toBeVisible();
    await sendBgMessage(harness, {
      state: buildUiState({
        status: '',
        settings: { tokenPresent: true, autoSummarize: false, model: 'free', length: 'xl' },
      }),
      type: 'ui:state',
    });

    await page.locator('#advancedSettings summary').click();
    await expect(page.locator('#modelRefresh')).toBeVisible();
    await page.locator('#modelRefresh').click();
    await expect(page.locator('#modelStatus')).toContainText('Free models updated.');
    await expect.poll(() => modelCalls).toBeGreaterThanOrEqual(2);
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel refresh free shows error on failure', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, { autoSummarize: false, token: 'test-token' });

    await harness.context.route('http://127.0.0.1:8787/v1/models', async (route) => {
      await route.fulfill({
        body: JSON.stringify({
          ok: true,
          options: [
            { id: 'auto', label: 'Auto' },
            { id: 'free', label: 'Free (OpenRouter)' },
          ],
          providers: {
            openrouter: true,
            openai: false,
            google: false,
            anthropic: false,
            xai: false,
            zai: false,
          },
          openaiBaseUrl: null,
          localModelsSource: null,
        }),
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    await harness.context.route('http://127.0.0.1:8787/v1/refresh-free', async (route) => {
      await route.fulfill({
        body: JSON.stringify({ ok: false, error: 'nope' }),
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await page.click('#drawerToggle');
    await expect(page.locator('#drawer')).toBeVisible();
    await sendBgMessage(harness, {
      state: buildUiState({
        status: '',
        settings: { tokenPresent: true, autoSummarize: false, model: 'free', length: 'xl' },
      }),
      type: 'ui:state',
    });

    await page.locator('#advancedSettings summary').click();
    await expect(page.locator('#modelRefresh')).toBeVisible();
    await page.locator('#modelRefresh').click();
    await expect(page.locator('#modelStatus')).toContainText('Refresh free failed');
    await expect(page.locator('#modelStatus')).toHaveAttribute('data-state', 'error');
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel mode picker applies overlay selection', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await page.click('#drawerToggle');
    await expect(page.locator('#drawer')).toBeVisible();

    const modeLabel = page.locator('label.mode');
    const modeTrigger = modeLabel.locator('.pickerTrigger');

    await modeTrigger.focus();
    await modeTrigger.press('Enter');
    const modeList = getOpenPickerList(page);
    await expect(modeList).toBeVisible();
    await modeList.locator('[role="option"]').nth(2).click();

    await expect(modeTrigger).toHaveText('Dark');
    await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel custom length input accepts typing', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await page.click('#drawerToggle');
    await expect(page.locator('#drawer')).toBeVisible();

    const lengthLabel = page.locator('label.length.mini');
    const lengthTrigger = lengthLabel.locator('.pickerTrigger').first();

    await lengthTrigger.click();
    const lengthList = getOpenPickerList(page);
    await expect(lengthList).toBeVisible();
    await lengthList.locator('.pickerOption', { hasText: 'Custom…' }).click();

    const customInput = page.locator('#lengthCustom');
    await expect(customInput).toBeVisible();
    await customInput.click();
    await customInput.fill('20k');
    await expect(customInput).toHaveValue('20k');

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel updates title after stream when tab title changes', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, { autoSummarize: false, token: 'test-token' });
    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(page);
    const sseBody = [
      'event: meta',
      'data: {"model":"test"}',
      '',
      'event: chunk',
      'data: {"text":"Hello world"}',
      '',
      'event: done',
      'data: {}',
      '',
    ].join('\n');

    await harness.context.route(
      /http:\/\/127\.0\.0\.1:8787\/v1\/summarize\/[^/]+\/events/,
      async (route) => {
        await route.fulfill({
          body: sseBody,
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        });
      },
    );

    await sendBgMessage(harness, {
      state: buildUiState({
        tab: { id: 1, url: 'https://example.com/video', title: 'Original Title' },
        settings: { autoSummarize: false, tokenPresent: true },
        status: '',
      }),
      type: 'ui:state',
    });

    await sendBgMessage(harness, {
      run: {
        id: 'run-1',
        model: 'auto',
        reason: 'manual',
        title: 'Original Title',
        url: 'https://example.com/video',
      },
      type: 'run:start',
    });

    await expect(page.locator('#title')).toHaveText('Original Title');
    await expect(page.locator('#render')).toContainText('Hello world');

    await sendBgMessage(harness, {
      state: buildUiState({
        tab: { url: 'https://example.com/video', title: 'Updated Title' },
        status: '',
      }),
      type: 'ui:state',
    });

    await expect(page.locator('#title')).toHaveText('Updated Title');
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel clears summary when tab url changes', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await mockDaemonSummarize(harness);
    await seedSettings(harness, { autoSummarize: false, token: 'test-token' });
    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');

    await sendBgMessage(harness, {
      state: buildUiState({
        tab: { url: 'https://example.com/old', title: 'Old Title' },
        settings: { autoSummarize: false, tokenPresent: true },
        status: '',
      }),
      type: 'ui:state',
    });

    await expect(page.locator('#title')).toHaveText('Old Title');
    await page.evaluate(() => {
      const host = document.querySelector('.render__markdownHost') as HTMLElement | null;
      if (host) {host.textContent = 'Hello world';}
    });
    await expect(page.locator('.render__markdownHost')).toContainText('Hello world');

    await sendBgMessage(harness, {
      state: buildUiState({
        tab: { url: 'https://example.com/new', title: 'New Title' },
        settings: { autoSummarize: false },
        status: '',
      }),
      type: 'ui:state',
    });

    await expect(page.locator('#title')).toHaveText('New Title');
    await expect(page.locator('#render')).toContainText('Click Summarize to start.');
    await expect(page.locator('#render')).toContainText('New Title');
    await expect(page.locator('#render')).not.toContainText('Hello world');
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});
