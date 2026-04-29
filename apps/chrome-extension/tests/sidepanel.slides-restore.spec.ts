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
  waitForApplySlidesHook,
  waitForSettingsHydratedHook,
} from './helpers/panel-hooks';

test.skip(
  ({ browserName }) => browserName === 'firefox' && !allowFirefoxExtensionTests,
  'Firefox extension tests are blocked by Playwright limitations. Set ALLOW_FIREFOX_EXTENSION_TESTS=1 to run.',
);

test('sidepanel resumes slides when returning to a tab', async ({
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

    const slidesPayload = {
      ocrAvailable: true,
      slides: [
        {
          index: 1,
          timestamp: 0,
          imageUrl: 'http://127.0.0.1:8787/v1/slides/alpha/1?v=1',
          ocrText: 'Alpha slide one.',
        },
      ],
      sourceId: 'alpha',
      sourceKind: 'youtube',
      sourceUrl: 'https://www.youtube.com/watch?v=abc123',
    };
    await page.route('http://127.0.0.1:8787/v1/summarize/**/slides', async (route) => {
      await route.fulfill({
        body: JSON.stringify({ ok: true, slides: slidesPayload }),
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });

    const slidesStreamBody = [
      'event: slides',
      `data: ${JSON.stringify(slidesPayload)}`,
      '',
      'event: done',
      'data: {}',
      '',
    ].join('\n');
    await page.route('http://127.0.0.1:8787/v1/summarize/slides-a/slides/events', async (route) => {
      await route.fulfill({
        body: slidesStreamBody,
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
    });
    await page.route('http://127.0.0.1:8787/v1/summarize/slides-a/events', async (route) => {
      await route.fulfill({
        body: ['event: done', 'data: {}', ''].join('\n'),
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
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
      tab: { id: 1, title: 'Alpha Video', url: 'https://www.youtube.com/watch?v=abc123' },
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
      tab: { id: 2, title: 'Bravo Tab', url: 'https://example.com' },
    });
    await sendBgMessage(harness, { state: tabAState, type: 'ui:state' });
    await sendBgMessage(harness, { state: tabBState, type: 'ui:state' });
    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(0);
    await sendBgMessage(harness, {
      ok: true,
      runId: 'slides-a',
      type: 'slides:run',
      url: 'https://www.youtube.com/watch?v=abc123',
    });
    await sendBgMessage(harness, { state: tabAState, type: 'ui:state' });
    await expect(page.locator('#title')).toHaveText('Alpha Video');

    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(1);
    const slides = await getPanelSlideDescriptions(page);
    expect(slides[0]?.[1] ?? '').toContain('Alpha');

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel replaces stale slides when rerunning the same video', async ({
  browserName: _browserName,
}, testInfo) => {
  const harness = await launchExtension(getBrowserFromProject(testInfo.project.name));

  try {
    await seedSettings(harness, {
      autoSummarize: false,
      slidesEnabled: true,
      slidesOcrEnabled: true,
      slidesParallel: false,
      token: 'test-token',
    });
    const page = await openExtensionPage(harness, 'sidepanel.html', '#title');
    await waitForPanelPort(page);
    await waitForSettingsHydratedHook(page);

    await page.route('http://127.0.0.1:8787/v1/summarize/**/events', async (route) => {
      const url = route.request().url();
      if (url.includes('/slides/events')) {
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
          `data: ${JSON.stringify({ text: 'Summary' })}`,
          '',
          'event: done',
          'data: {}',
          '',
        ].join('\n'),
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
    });
    await page.route('http://127.0.0.1:8787/v1/summarize/**/slides', async (route) => {
      await route.fulfill({
        body: JSON.stringify({ ok: false, error: 'not found' }),
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
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

    const uiState = buildUiState({
      media: { hasAudio: true, hasCaptions: true, hasVideo: true },
      settings: {
        autoSummarize: false,
        slidesEnabled: true,
        slidesOcrEnabled: true,
        slidesParallel: false,
        tokenPresent: true,
      },
      tab: { id: 1, title: 'Rerun Video', url: 'https://www.youtube.com/watch?v=rerun123' },
    });
    await sendBgMessage(harness, { state: uiState, type: 'ui:state' });

    await sendBgMessage(harness, {
      run: {
        id: 'run-1',
        model: 'auto',
        reason: 'manual',
        title: 'Rerun Video',
        url: 'https://www.youtube.com/watch?v=rerun123',
      },
      type: 'run:start',
    });
    await expect(page.locator('#render')).toContainText('Summary');

    await page.evaluate(
      (payload) => {
        const hooks = (
          window as typeof globalThis & {
            __summarizeTestHooks?: { applySlidesPayload?: (value: unknown) => void };
          }
        ).__summarizeTestHooks;
        hooks?.applySlidesPayload?.(payload);
      },
      {
        ocrAvailable: true,
        slides: [
          {
            index: 1,
            timestamp: 0,
            imageUrl: 'http://127.0.0.1:8787/v1/slides/youtube-rerun/1?v=1',
            ocrText: 'First run slide one.',
          },
          {
            index: 2,
            timestamp: 20,
            imageUrl: 'http://127.0.0.1:8787/v1/slides/youtube-rerun/2?v=1',
            ocrText: 'First run slide two.',
          },
          {
            index: 3,
            timestamp: 40,
            imageUrl: 'http://127.0.0.1:8787/v1/slides/youtube-rerun/3?v=1',
            ocrText: 'First run slide three.',
          },
        ],
        sourceId: 'youtube-rerun',
        sourceKind: 'youtube',
        sourceUrl: 'https://www.youtube.com/watch?v=rerun123',
      },
    );
    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(3);

    await sendBgMessage(harness, {
      run: {
        id: 'run-2',
        model: 'auto',
        reason: 'manual',
        title: 'Rerun Video',
        url: 'https://www.youtube.com/watch?v=rerun123',
      },
      type: 'run:start',
    });
    await expect(page.locator('#render')).toContainText('Summary');

    await page.evaluate(
      (payload) => {
        const hooks = (
          window as typeof globalThis & {
            __summarizeTestHooks?: { applySlidesPayload?: (value: unknown) => void };
          }
        ).__summarizeTestHooks;
        hooks?.applySlidesPayload?.(payload);
      },
      {
        ocrAvailable: true,
        slides: [
          {
            index: 1,
            timestamp: 5,
            imageUrl: 'http://127.0.0.1:8787/v1/slides/youtube-rerun/1?v=2',
            ocrText: 'Second run only slide.',
          },
        ],
        sourceId: 'youtube-rerun',
        sourceKind: 'youtube',
        sourceUrl: 'https://www.youtube.com/watch?v=rerun123',
      },
    );

    await expect.poll(async () => (await getPanelSlideDescriptions(page)).length).toBe(1);
    const slides = await getPanelSlideDescriptions(page);
    expect(slides[0]?.[1] ?? '').toContain('Second run only slide');
    expect(slides.some(([, text]) => text.includes('First run slide two'))).toBe(false);

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});

test('sidepanel starts pending slides after returning to a tab with seeded placeholders', async ({
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
    await waitForApplySlidesHook(page);

    const targetUrl = 'https://www.youtube.com/watch?v=abc123';
    const slidesPayload = buildSlidesPayload({
      count: 1,
      sourceId: 'youtube-abc123',
      sourceUrl: targetUrl,
      textPrefix: 'Alpha',
    });

    const summaryBody = (text: string) =>
      ['event: chunk', `data: ${JSON.stringify({ text })}`, '', 'event: done', 'data: {}', ''].join(
        '\n',
      );

    await page.route('http://127.0.0.1:8787/v1/summarize/summary-a/events', async (route) => {
      await route.fulfill({
        body: summaryBody('Summary A'),
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
    });
    await page.route('http://127.0.0.1:8787/v1/summarize/slides-a/events', async (route) => {
      await route.fulfill({
        body: summaryBody('Slides summary A'),
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
    });
    await page.route('http://127.0.0.1:8787/v1/summarize/**/slides', async (route) => {
      await route.fulfill({
        body: JSON.stringify({ ok: true, slides: slidesPayload }),
        headers: { 'content-type': 'application/json' },
        status: 200,
      });
    });
    await page.route('http://127.0.0.1:8787/v1/summarize/slides-a/slides/events', async (route) => {
      await route.fulfill({
        body: [
          'event: slides',
          `data: ${JSON.stringify(slidesPayload)}`,
          '',
          'event: done',
          'data: {}',
          '',
        ].join('\n'),
        headers: { 'content-type': 'text/event-stream' },
        status: 200,
      });
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
      stats: { pageWords: 120, videoDurationSeconds: 120 },
      tab: { id: 1, title: 'Alpha Video', url: targetUrl },
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
      tab: { id: 2, title: 'Bravo Tab', url: 'https://example.com' },
    });
    await sendBgMessage(harness, { state: tabAState, type: 'ui:state' });
    await expect(page.locator('#title')).toHaveText('Alpha Video');
    await sendBgMessage(harness, {
      run: {
        id: 'summary-a',
        model: 'auto',
        reason: 'manual',
        title: 'Alpha Video',
        url: targetUrl,
      },
      type: 'run:start',
    });
    await expect
      .poll(async () => (await getPanelSlidesTimeline(page)).length, { timeout: 10_000 })
      .toBeGreaterThan(1);

    await sendBgMessage(harness, { state: tabBState, type: 'ui:state' });
    await expect(page.locator('#title')).toHaveText('Bravo Tab');
    const waitForSlidesEvents = page.waitForResponse(
      (response) =>
        response.url().includes('/v1/summarize/slides-a/slides/events') &&
        response.status() === 200,
      { timeout: 10_000 },
    );
    await sendBgMessage(harness, {
      ok: true,
      runId: 'slides-a',
      type: 'slides:run',
      url: targetUrl,
    });
    await sendBgMessage(harness, { state: tabAState, type: 'ui:state' });
    await expect(page.locator('#title')).toHaveText('Alpha Video');
    await waitForSlidesEvents;

    await expect.poll(async () => (await getPanelSlidesTimeline(page)).length).toBe(1);
    const slides = await getPanelSlideDescriptions(page);
    expect(slides.some(([, text]) => text.includes('Alpha'))).toBe(true);

    assertNoErrors(harness);
  } finally {
    await closeExtension(harness.context, harness.userDataDir);
  }
});
