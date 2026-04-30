import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';

import { describe, expect, it } from 'vitest';

import { renderSlidesInline } from '../src/run/slides-render.js';

const pngData = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO3kq0cAAAAASUVORK5CYII=',
  'base64',
);

function createTtyStream(columns = 120) {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  (stream as unknown as { isTTY?: boolean }).isTTY = true;
  (stream as unknown as { columns?: number }).columns = columns;
  return { getText: () => text, stream };
}

function createTtyStreamWithoutColumns() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  (stream as unknown as { isTTY?: boolean }).isTTY = true;
  return { getText: () => text, stream };
}

function createNonTtyStream() {
  let text = '';
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      text += chunk.toString();
      callback();
    },
  });
  (stream as unknown as { isTTY?: boolean }).isTTY = false;
  return { getText: () => text, stream };
}

async function createTempSlide() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gist-slides-'));
  const imagePath = path.join(dir, 'slide_0001.png');
  await fs.writeFile(imagePath, pngData);
  return imagePath;
}

describe('renderSlidesInline', () => {
  it('returns none when mode is disabled', async () => {
    const output = createTtyStream();
    const result = await renderSlidesInline({
      env: {},
      mode: 'none',
      slides: [{ imagePath: '/tmp/missing.png', index: 1, timestamp: 0 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('none');
    expect(result.rendered).toBe(0);
    expect(output.getText()).toBe('');
  });

  it('renders kitty images when auto-detected', async () => {
    const imagePath = await createTempSlide();
    const output = createTtyStream();
    const result = await renderSlidesInline({
      env: { KITTY_WINDOW_ID: '1', TERM: 'xterm-kitty' },
      labelForSlide: () => 'Slide 1',
      mode: 'auto',
      slides: [{ imagePath, index: 1, timestamp: 12.3 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('kitty');
    expect(result.rendered).toBe(1);
    expect(output.getText()).toContain('Slide 1');
    expect(output.getText()).toContain('\u001B_G');
    expect(output.getText()).toContain('c=64');
  });

  it('skips rendering when stdout is not a TTY', async () => {
    const imagePath = await createTempSlide();
    const output = createNonTtyStream();
    const result = await renderSlidesInline({
      env: { TERM: 'xterm-kitty' },
      mode: 'kitty',
      slides: [{ imagePath, index: 1, timestamp: 12.3 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('none');
    expect(result.rendered).toBe(0);
    expect(output.getText()).toBe('');
  });

  it('renders kitty images when Konsole is detected', async () => {
    const imagePath = await createTempSlide();
    const output = createTtyStream();
    const result = await renderSlidesInline({
      env: { TERM_PROGRAM: 'konsole' },
      mode: 'auto',
      slides: [{ imagePath, index: 1, timestamp: 1.2 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('kitty');
    expect(result.rendered).toBe(1);
    expect(output.getText()).toContain('\u001B_G');
  });

  it('renders iTerm images when auto-detected', async () => {
    const imagePath = await createTempSlide();
    const output = createTtyStream();
    const result = await renderSlidesInline({
      env: { TERM_PROGRAM: 'iTerm.app' },
      mode: 'auto',
      slides: [{ imagePath, index: 1, timestamp: 4.2 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('iterm');
    expect(result.rendered).toBe(1);
    expect(output.getText()).toContain('\u001B]1337;File=');
    expect(output.getText()).toContain('width=64');
  });

  it('uses COLUMNS when stdout columns are unavailable', async () => {
    const imagePath = await createTempSlide();
    const output = createTtyStreamWithoutColumns();
    const result = await renderSlidesInline({
      env: { COLUMNS: '90', TERM: 'xterm-kitty' },
      mode: 'auto',
      slides: [{ imagePath, index: 1, timestamp: 9.1 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('kitty');
    expect(result.rendered).toBe(1);
    expect(output.getText()).toContain('c=54');
  });

  it('caps inline width at double the previous size on wide terminals', async () => {
    const imagePath = await createTempSlide();
    const output = createTtyStream(200);
    const result = await renderSlidesInline({
      env: { TERM: 'xterm-kitty' },
      mode: 'auto',
      slides: [{ imagePath, index: 1, timestamp: 9.1 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('kitty');
    expect(result.rendered).toBe(1);
    expect(output.getText()).toContain('c=64');
  });

  it('renders iTerm images when WezTerm is detected', async () => {
    const imagePath = await createTempSlide();
    const output = createTtyStream();
    const result = await renderSlidesInline({
      env: { TERM_PROGRAM: 'WezTerm' },
      mode: 'auto',
      slides: [{ imagePath, index: 1, timestamp: 5.1 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('iterm');
    expect(result.rendered).toBe(1);
    expect(output.getText()).toContain('\u001B]1337;File=');
  });

  it('renders iTerm images when WezTerm is detected via WEZTERM_EXECUTABLE', async () => {
    const imagePath = await createTempSlide();
    const output = createTtyStream();
    const result = await renderSlidesInline({
      env: { WEZTERM_EXECUTABLE: '/Applications/WezTerm.app/Contents/MacOS/wezterm' },
      mode: 'auto',
      slides: [{ imagePath, index: 1, timestamp: 5.4 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('iterm');
    expect(result.rendered).toBe(1);
    expect(output.getText()).toContain('\u001B]1337;File=');
  });

  it('does not render inline images for unsupported terminals', async () => {
    const imagePath = await createTempSlide();
    const output = createTtyStream();
    const result = await renderSlidesInline({
      env: { TERM_PROGRAM: 'Terminal.app' },
      mode: 'auto',
      slides: [{ imagePath, index: 1, timestamp: 4.2 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('none');
    expect(result.rendered).toBe(0);
    expect(output.getText()).toBe('');
  });

  it('prints a missing image notice when slides are absent', async () => {
    const output = createTtyStream();
    const result = await renderSlidesInline({
      env: { KITTY_WINDOW_ID: '1', TERM: 'xterm-kitty' },
      mode: 'auto',
      slides: [{ imagePath: '/tmp/missing-slide.png', index: 1, timestamp: 0 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('kitty');
    expect(result.rendered).toBe(0);
    expect(output.getText()).toContain('(missing slide image)');
  });

  it('prints an empty image notice when the slide is blank', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gist-slides-'));
    const imagePath = path.join(dir, 'slide_0001.png');
    await fs.writeFile(imagePath, Buffer.alloc(0));
    const output = createTtyStream();
    const result = await renderSlidesInline({
      env: { TERM_PROGRAM: 'iTerm.app' },
      mode: 'auto',
      slides: [{ imagePath, index: 1, timestamp: 0 }],
      stdout: output.stream,
    });
    expect(result.protocol).toBe('iterm');
    expect(result.rendered).toBe(0);
    expect(output.getText()).toContain('(empty slide image)');
    await fs.rm(dir, { force: true, recursive: true });
  });
});
