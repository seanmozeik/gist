import { expect, test } from '@playwright/test';

import {
  activateTabByUrl,
  assertNoErrors,
  buildUiState,
  closeExtension,
  getBrowserFromProject,
  injectContentScript,
  launchExtension,
  maybeBringToFront,
  openExtensionPage,
  seedSettings,
  sendBgMessage,
  waitForActiveTabUrl,
  waitForExtractReady,
  waitForPanelPort,
} from './helpers/extension-harness';
import { allowFirefoxExtensionTests } from './helpers/extension-test-config';
import { waitForSettingsHydratedHook } from './helpers/panel-hooks';

test.skip(
  ({ browserName }) => browserName === 'firefox' && !allowFirefoxExtensionTests,
  'Firefox extension tests are blocked by Playwright limitations. Set ALLOW_FIREFOX_EXTENSION_TESTS=1 to run.',
);

test('sidepanel shows an error when agent request fails', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, { autoSummarize: false, chatEnabled: true, token: 'test-token' });
    const contentPage = await harness.context.newPage();
    await contentPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await contentPage.evaluate(() => {
      document.body.innerHTML = `<article><p>${'Agent error test. '.repeat(12)}</p></article>`;
    });
    await maybeBringToFront(contentPage);
    await activateTabByUrl(harness, 'https://example.com');
    await waitForActiveTabUrl(harness, 'https://example.com');
    await injectContentScript(harness, 'content-scripts/extract.js', 'https://example.com');
    await waitForExtractReady(harness, 'https://example.com');

    let agentCalls = 0;
    await harness.context.route('http://127.0.0.1:8787/v1/agent', async (route) => {
      agentCalls += 1;
      await route.fulfill({ body: 'Boom', headers: { 'content-type': 'text/plain' }, status: 500 });
    });

    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await maybeBringToFront(contentPage);
    await activateTabByUrl(harness, 'https://example.com');
    await waitForActiveTabUrl(harness, 'https://example.com');
    await sendBgMessage(harness, {
      state: buildUiState({
        tab: { id: 1, url: 'https://example.com', title: 'Example' },
        settings: { chatEnabled: true, tokenPresent: true },
      }),
      type: 'ui:state',
    });

    await expect(page.locator('#chatSend')).toBeEnabled();
    await page.evaluate((value) => {
      const input = document.querySelector('#chatInput') as HTMLTextAreaElement | null;
      const send = document.querySelector('#chatSend') as HTMLButtonElement | null;
      if (!input || !send) {return;}
      input.value = value;
      input.dispatchEvent(new Event('input', { bubbles: true }));
      send.click();
    }, 'Trigger agent error');

    await expect.poll(() => agentCalls).toBe(1);
    await expect(page.locator('#inlineError')).toBeVisible();
    await expect(page.locator('#inlineErrorMessage')).toContainText(
      /Chat request failed: Boom|Tab changed/,
    );
    await expect(page.locator('.chatMessage.assistant.streaming')).toHaveCount(0);
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel hides inline error when message is empty', async ({
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
      const hooks = (
        window as typeof globalThis & {
          __summarizeTestHooks?: {
            showInlineError?: (message: string) => void;
            isInlineErrorVisible?: () => boolean;
            getInlineErrorMessage?: () => string;
          };
        }
      ).__summarizeTestHooks;
      hooks?.showInlineError?.('Boom');
    });
    await expect(page.locator('#inlineError')).toBeVisible();

    await page.evaluate(() => {
      const hooks = (
        window as typeof globalThis & {
          __summarizeTestHooks?: {
            showInlineError?: (message: string) => void;
            isInlineErrorVisible?: () => boolean;
            getInlineErrorMessage?: () => string;
          };
        }
      ).__summarizeTestHooks;
      hooks?.showInlineError?.('   ');
    });

    await expect(page.locator('#inlineError')).toBeHidden();
    await expect(page.locator('#inlineErrorMessage')).toHaveText('');
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel shows daemon upgrade hint when /v1/agent is missing', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, { autoSummarize: false, chatEnabled: true, token: 'test-token' });
    const contentPage = await harness.context.newPage();
    await contentPage.goto('https://example.com', { waitUntil: 'domcontentloaded' });
    await contentPage.evaluate(() => {
      document.body.innerHTML = `<article><p>${'Agent 404 test. '.repeat(12)}</p></article>`;
    });
    await maybeBringToFront(contentPage);
    await activateTabByUrl(harness, 'https://example.com');
    await waitForActiveTabUrl(harness, 'https://example.com');
    await injectContentScript(harness, 'content-scripts/extract.js', 'https://example.com');
    await waitForExtractReady(harness, 'https://example.com');

    let agentCalls = 0;
    await harness.context.route('http://127.0.0.1:8787/v1/agent', async (route) => {
      agentCalls += 1;
      await route.fulfill({
        body: 'Not Found',
        headers: { 'content-type': 'text/plain' },
        status: 404,
      });
    });

    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);
    await maybeBringToFront(contentPage);
    await activateTabByUrl(harness, 'https://example.com');
    await waitForActiveTabUrl(harness, 'https://example.com');
    await sendBgMessage(harness, {
      state: buildUiState({
        tab: { id: 1, url: 'https://example.com', title: 'Example' },
        settings: { chatEnabled: true, tokenPresent: true },
      }),
      type: 'ui:state',
    });

    await expect(page.locator('#chatSend')).toBeEnabled();
    await page.locator('#chatInput').fill('Trigger agent 404');
    await page.locator('#chatSend').click();

    await expect.poll(() => agentCalls).toBe(1);
    await expect(page.locator('#inlineError')).toBeVisible();
    await expect(page.locator('#inlineErrorMessage')).toContainText(
      'Daemon does not support /v1/agent',
    );
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel shows automation notice when permission event fires', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(page);
    await page.evaluate(() => {
      window.dispatchEvent(
        new CustomEvent('summarize:automation-permissions', {
          detail: {
            ctaLabel: 'Open extension details',
            message: 'Enable User Scripts to use automation.',
            title: 'User Scripts required',
          },
        }),
      );
    });

    await expect(page.locator('#automationNotice')).toBeVisible();
    await expect(page.locator('#automationNoticeMessage')).toContainText('Enable User Scripts');
    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});
