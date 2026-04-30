import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  type AssetAttachment,
  assertAssetMediaTypeSupported,
  ensureCliAttachmentPath,
  getFileBytesFromAttachment,
  getTextContentFromAttachment,
  isTextLikeMediaType,
  isUnsupportedAttachmentError,
  shouldMarkitdownConvertMediaType,
  supportsNativeFileAttachment,
} from '../src/run/attachments.js';

describe('run/attachments', () => {
  it('detects unsupported attachment errors', () => {
    expect(isUnsupportedAttachmentError(null)).toBe(false);
    expect(isUnsupportedAttachmentError(new Error('Functionality not supported'))).toBe(true);
    expect(isUnsupportedAttachmentError(new Error('functionality not supported: nope'))).toBe(true);
    expect(isUnsupportedAttachmentError({ name: 'UnsupportedFunctionalityError' })).toBe(true);
  });

  it('detects text-like media types', () => {
    expect(isTextLikeMediaType('text/plain')).toBe(true);
    expect(isTextLikeMediaType('application/json')).toBe(true);
    expect(isTextLikeMediaType('application/pdf')).toBe(false);
  });

  it('extracts text content from file attachments', () => {
    const a1 = {
      bytes: new TextEncoder().encode('{"ok":true}'),
      filename: 'a.json',
      kind: 'file',
      mediaType: 'application/json',
    } as unknown as AssetAttachment;
    expect(getTextContentFromAttachment(a1)).toMatchObject({ content: '{"ok":true}' });

    const a2 = {
      bytes: new TextEncoder().encode('<ok/>'),
      filename: 'a.xml',
      kind: 'file',
      mediaType: 'application/xml',
    } as unknown as AssetAttachment;
    expect(getTextContentFromAttachment(a2)?.content).toContain('<ok/>');

    const a3 = {
      bytes: new TextEncoder().encode('%PDF-1.7'),
      kind: 'file',
      mediaType: 'application/pdf',
    } as unknown as AssetAttachment;
    expect(getTextContentFromAttachment(a3)).toBeNull();
  });

  it('rejects archive media types', () => {
    const zip = {
      bytes: new Uint8Array([1]),
      kind: 'file',
      mediaType: 'application/zip',
    } as unknown as AssetAttachment;
    expect(() => {
      assertAssetMediaTypeSupported({ attachment: zip, sizeLabel: '1B' });
    }).toThrow(/Unsupported file type/i);
  });

  it('passes through non-archive attachments', () => {
    const txt = {
      bytes: new Uint8Array([1, 2]),
      kind: 'file',
      mediaType: 'text/plain',
    } as unknown as AssetAttachment;
    expect(() => {
      assertAssetMediaTypeSupported({ attachment: txt, sizeLabel: null });
    }).not.toThrow();
  });

  it('returns raw bytes for file attachments', () => {
    const bytes = new Uint8Array([3, 4, 5]);
    const fileAttachment = {
      bytes,
      kind: 'file',
      mediaType: 'application/octet-stream',
    } as unknown as AssetAttachment;
    expect(getFileBytesFromAttachment(fileAttachment)).toBe(bytes);

    const nonFile = { bytes, kind: 'image', mediaType: 'image/png' } as unknown as AssetAttachment;
    expect(getFileBytesFromAttachment(nonFile)).toBeNull();
  });

  it('writes CLI attachment paths for asset URLs', async () => {
    const bytes = new Uint8Array([65, 66, 67]);
    const attachment = {
      bytes,
      filename: 'data.json',
      kind: 'file',
      mediaType: 'application/json',
    } as unknown as AssetAttachment;
    const filePath = await ensureCliAttachmentPath({
      attachment,
      sourceKind: 'asset-url',
      sourceLabel: 'https://example.com/data.json',
    });
    const contents = await fs.readFile(filePath);
    expect(contents).toEqual(Buffer.from(bytes));
    await fs.rm(path.dirname(filePath), { force: true, recursive: true });
  });

  it('throws when CLI attachment bytes are missing', async () => {
    const attachment = {
      bytes: null,
      kind: 'file',
      mediaType: 'application/json',
    } as unknown as AssetAttachment;
    await expect(
      ensureCliAttachmentPath({
        attachment,
        sourceKind: 'asset-url',
        sourceLabel: 'https://example.com/data.json',
      }),
    ).rejects.toThrow('CLI attachment missing bytes');
  });

  it('keeps file source paths as-is', async () => {
    const base = await fs.mkdtemp(path.join(os.tmpdir(), 'gist-asset-'));
    const filePath = path.join(base, 'sample.txt');
    await fs.writeFile(filePath, 'ok');
    const attachment = {
      bytes: new Uint8Array([1]),
      filename: 'sample.txt',
      kind: 'file',
      mediaType: 'text/plain',
    } as unknown as AssetAttachment;
    const resolved = await ensureCliAttachmentPath({
      attachment,
      sourceKind: 'file',
      sourceLabel: filePath,
    });
    expect(resolved).toBe(filePath);
    await fs.rm(base, { force: true, recursive: true });
  });

  it('detects native file attachment support', () => {
    expect(
      supportsNativeFileAttachment({
        attachment: { kind: 'file', mediaType: 'application/pdf' },
        provider: 'anthropic',
      }),
    ).toBe(true);
    expect(
      supportsNativeFileAttachment({
        attachment: { kind: 'file', mediaType: 'application/pdf' },
        provider: 'openai',
      }),
    ).toBe(true);
    expect(
      supportsNativeFileAttachment({
        attachment: { kind: 'file', mediaType: 'application/pdf' },
        provider: 'google',
      }),
    ).toBe(true);
    expect(
      supportsNativeFileAttachment({
        attachment: { kind: 'file', mediaType: 'application/pdf' },
        provider: 'xai',
      }),
    ).toBe(false);
    expect(
      supportsNativeFileAttachment({
        attachment: { kind: 'image', mediaType: 'image/png' },
        provider: 'openai',
      }),
    ).toBe(false);
  });

  it('flags media types that should use markitdown', () => {
    expect(shouldMarkitdownConvertMediaType('application/pdf')).toBe(true);
    expect(shouldMarkitdownConvertMediaType('text/html')).toBe(true);
    expect(shouldMarkitdownConvertMediaType('application/vnd.ms-excel')).toBe(true);
    expect(shouldMarkitdownConvertMediaType('application/json')).toBe(false);
  });
});
