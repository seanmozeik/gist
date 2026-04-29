import { expect, test } from '@playwright/test';

import { buildSlidesPayload } from './helpers/daemon-fixtures';
import {
  assertNoErrors,
  buildUiState,
  closeExtension,
  getBrowserFromProject,
  launchExtension,
  openExtensionPage,
  seedSettings,
  sendBgMessage,
  waitForPanelPort,
} from './helpers/extension-harness';
import { allowFirefoxExtensionTests } from './helpers/extension-test-config';
import {
  getPanelSlideDescriptions,
  getPanelSlidesTimeline,
  getPanelSummaryMarkdown,
  waitForApplySlidesHook,
  waitForSettingsHydratedHook,
} from './helpers/panel-hooks';

test.skip(
  ({ browserName }) => browserName === 'firefox' && !allowFirefoxExtensionTests,
  'Firefox extension tests are blocked by Playwright limitations. Set ALLOW_FIREFOX_EXTENSION_TESTS=1 to run.',
);

test('sidepanel reconnects cached slide runs after tab restore', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, {
      autoSummarize: false,
      slidesEnabled: true,
      slidesOcrEnabled: true,
      slidesParallel: true,
      token: 'test-token',
    });
    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);

    const sseBody = (text: string) =>
      ['event: chunk', `data: ${JSON.stringify({ text })}`, '', 'event: done', 'data: {}', ''].join(
        '\n',
      );
    await page.route('http://127.0.0.1:8787/v1/summarize/run-a/events', async (route) => {
      await route.fulfill({
        body: sseBody('Summary A'),
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
    });
    await page.route('http://127.0.0.1:8787/v1/summarize/slides-a/events', async (route) => {
      await route.fulfill({
        body: sseBody('Slides summary A'),
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
    });

    const slidesPayload = {
      ocrAvailable: true,
      slides: [
        {
          index: 1,
          timestamp: 0,
          imageUrl: 'http://127.0.0.1:8787/v1/slides/cache-run/1?v=1',
          ocrText: 'Cached slide one.',
        },
      ],
      sourceId: 'cache-run',
      sourceKind: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=cache123',
    };
    const slidesStreamBody = [
      'event: slides',
      `data: ${JSON.stringify(slidesPayload)}`,
      '',
      'event: done',
      'data: {}',
      '',
    ].join('\n');
    let slidesEventsRequests = 0;
    await page.route('http://127.0.0.1:8787/v1/summarize/slides-a/slides/events', async (route) => {
      slidesEventsRequests += 1;
      if (slidesEventsRequests === 1) {
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
      try {
        await route.fulfill({
          body: slidesStreamBody,
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        });
      } catch {
        // First request is intentionally abandoned when the tab changes.
      }
    });

    const placeholderPng = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3kq0cAAAAASUVORK5CYII=',
      'base64',
    );
    await page.route('http://127.0.0.1:8787/v1/slides/**', async (route) => {
      await route.fulfill({
        body: placeholderPng,
        headers: { 'content-type': 'image/png', 'x-summarize-slide-ready': '1' },
        status: 200,
      });
    });

    const tabAState = buildUiState({
      media: { hasAudio: true, hasCaptions: true, hasVideo: true },
      settings: {
        autoSummarize: false,
        slidesEnabled: true,
        slidesOcrEnabled: true,
        slidesParallel: true,
        tokenPresent: true,
      },
      tab: { id: 1, title: 'Cached Video', url: 'https://www.youtube.com/watch?v=cache123' },
    });
    const tabBState = buildUiState({
      media: { hasAudio: false, hasCaptions: false, hasVideo: false },
      settings: {
        autoSummarize: false,
        slidesEnabled: true,
        slidesOcrEnabled: true,
        slidesParallel: true,
        tokenPresent: true,
      },
      tab: { id: 2, title: 'Other Tab', url: 'https://example.com' },
    });

    await sendBgMessage(harness, { state: tabAState, type: 'ui:state' });
    await sendBgMessage(harness, {
      run: {
        id: 'run-a',
        model: 'auto',
        reason: 'manual',
        title: 'Cached Video',
        url: 'https://www.youtube.com/watch?v=cache123',
      },
      type: 'run:start',
    });
    await expect(page.locator('#render')).toContainText('Summary A');

    await sendBgMessage(harness, {
      ok: true,
      runId: 'slides-a',
      type: 'slides:run',
      url: 'https://www.youtube.com/watch?v=cache123',
    });
    await expect.poll(async () => slidesEventsRequests).toBe(1);

    await sendBgMessage(harness, { state: tabBState, type: 'ui:state' });
    await expect(page.locator('#title')).toHaveText('Other Tab');
    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(0);

    await sendBgMessage(harness, { state: tabAState, type: 'ui:state' });
    await expect.poll(async () =>  getPanelSummaryMarkdown(page)).toContain('Summary A');
    await expect.poll(async () => slidesEventsRequests).toBe(2);

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel retry requests a fresh run when parallel slides have no run id', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, {
      autoSummarize: false,
      slidesEnabled: true,
      slidesParallel: true,
      token: 'test-token',
    });
    const url = 'https://www.youtube.com/watch?v=retry12345';
    const panel = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(panel);
    await waitForSettingsHydratedHook(panel);

    await panel.route('http://127.0.0.1:8787/v1/summarize/**/events', async (route) => {
      const requestUrl = route.request().url();
      if (requestUrl.includes('/slides/events')) {
        await route.fulfill({
          body: ['event: done', 'data: {}', ''].join('\n'),
          headers: { 'content-type': 'text/event-stream' },
          status: 200,
        });
        return;
      }
      await route.fulfill({
        body: [
          'event: chunk',
          `data: ${JSON.stringify({ text: 'Video summary' })}`,
          '',
          'event: done',
          'data: {}',
          '',
        ].join('\n'),
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
    });

    await sendBgMessage(harness, {
      state: buildUiState({
        tab: { id: 1, url, title: 'Retry Video' },
        media: { hasVideo: true, hasAudio: true, hasCaptions: true },
        settings: {
          autoSummarize: false,
          slidesEnabled: true,
          slidesParallel: true,
          tokenPresent: true,
        },
      }),
      type: 'ui:state',
    });
    await sendBgMessage(harness, {
      run: { id: 'summary-run', model: 'auto', reason: 'manual', title: 'Retry Video', url },
      type: 'run:start',
    });
    await expect(panel.locator('#render')).toContainText('Video summary');

    await sendBgMessage(harness, { error: 'Slides request failed', ok: false, type: 'slides:run' });
    await expect(panel.locator('#slideNotice')).toContainText('Slides request failed');
    await expect(panel.locator('#slideNoticeRetry')).toBeVisible();
    await panel.evaluate(() => {
      const port = (
        window as typeof globalThis & {
          __summarizePanelPort?: { postMessage: (payload: object) => void };
          __capturedPanelMessages?: object[];
        }
      ).__summarizePanelPort;
      if (!port) {throw new Error('Missing panel port');}
      const captured: object[] = [];
      (
        window as typeof globalThis & { __capturedPanelMessages?: object[] }
      ).__capturedPanelMessages = captured;
      port.postMessage = (payload: object) => {
        captured.push(payload);
      };
    });
    await panel.locator('#slideNoticeRetry').click();
    await expect
      .poll(async () => {
        return await panel.evaluate(() => {
          return (
            (
              window as typeof globalThis & {
                __capturedPanelMessages?: { type?: string; refresh?: boolean }[];
              }
            ).__capturedPanelMessages ?? []
          ).map((message) => ({ refresh: message.refresh ?? null, type: message.type ?? null }));
        });
      })
      .toContainEqual({ refresh: true, type: 'panel:summarize' });

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});
