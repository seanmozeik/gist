import {
  deleteArtifact,
  getArtifactRecord,
  listArtifacts,
  parseArtifact,
  upsertArtifact,
} from '../../automation/artifacts-store';
import {
  getNativeInputGuardError,
  updateNativeInputArmedTabs,
} from '../../automation/native-input-guard';

export interface NativeInputRequest {
  type: 'automation:native-input';
  payload: {
    action: 'click' | 'type' | 'press' | 'keydown' | 'keyup';
    x?: number;
    y?: number;
    text?: string;
    key?: string;
  };
}

export type NativeInputResponse = { ok: true } | { ok: false; error: string };

export interface ArtifactsRequest {
  type: 'automation:artifacts';
  requestId: string;
  action?: string;
  payload?: unknown;
}

type RuntimeMessage =
  | NativeInputRequest
  | ArtifactsRequest
  | { type: 'automation:native-input-arm' };

function safeSendResponse(sendResponse: (response?: unknown) => void, value: unknown) {
  try {
    sendResponse(value);
  } catch {
    // Ignore
  }
}

function resolveKeyCode(key: string): { code: string; keyCode: number; text?: string } {
  const named: Record<string, number> = {
    ArrowDown: 40,
    ArrowLeft: 37,
    ArrowRight: 39,
    ArrowUp: 38,
    Backspace: 8,
    Delete: 46,
    End: 35,
    Enter: 13,
    Escape: 27,
    Home: 36,
    PageDown: 34,
    PageUp: 33,
    Space: 32,
    Tab: 9,
  };
  if (named[key]) {
    return { code: key, keyCode: named[key] };
  }
  if (key.length === 1) {
    const upper = key.toUpperCase();
    return { code: upper, keyCode: upper.codePointAt(0), text: key };
  }
  return { code: key, keyCode: 0 };
}

async function dispatchNativeInput(
  tabId: number,
  payload: NativeInputRequest['payload'],
): Promise<NativeInputResponse> {
  const hasPermission = await chrome.permissions.contains({ permissions: ['debugger'] });
  if (!hasPermission) {
    return { error: 'Debugger permission not granted.', ok: false };
  }

  try {
    await chrome.debugger.attach({ tabId }, '1.3');
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes('already attached')) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const send = (method: string, params: Record<string, unknown>) =>
    chrome.debugger.sendCommand({ tabId }, method, params);

  try {
    switch (payload.action) {
      case 'click': {
        const x = payload.x ?? 0;
        const y = payload.y ?? 0;
        await send('Input.dispatchMouseEvent', {
          button: 'left',
          clickCount: 1,
          type: 'mousePressed',
          x,
          y,
        });
        await send('Input.dispatchMouseEvent', {
          button: 'left',
          clickCount: 1,
          type: 'mouseReleased',
          x,
          y,
        });
        return { ok: true };
      }
      case 'type': {
        const text = payload.text ?? '';
        if (!text) {return { ok: false, error: 'Missing text' };}
        await send('Input.insertText', { text });
        return { ok: true };
      }
      case 'press':
      case 'keydown':
      case 'keyup': {
        const key = payload.key ?? '';
        if (!key) {return { ok: false, error: 'Missing key' };}
        const { code, keyCode, text } = resolveKeyCode(key);
        const sendKey = async (type: string) =>
          send('Input.dispatchKeyEvent', {
            code,
            key,
            nativeVirtualKeyCode: keyCode,
            text,
            type,
            windowsVirtualKeyCode: keyCode,
          });
        if (payload.action === 'press') {
          await sendKey('keyDown');
          await sendKey('keyUp');
          return { ok: true };
        }
        await sendKey(payload.action === 'keydown' ? 'keyDown' : 'keyUp');
        return { ok: true };
      }
      default: {
        return { ok: false, error: 'Unknown action' };
      }
    }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch {
      // Ignore
    }
  }
}

export function createRuntimeActionsHandler({ armedTabs }: { armedTabs: Set<number> }) {
  return (
    raw: unknown,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ): boolean | undefined => {
    if (!raw || typeof raw !== 'object' || typeof (raw as { type?: unknown }).type !== 'string') {
      return;
    }

    const {type} = (raw as RuntimeMessage);
    if (type === 'automation:native-input-arm') {
      const msg = raw as { tabId?: number; enabled?: boolean };
      updateNativeInputArmedTabs({
        armedTabs,
        enabled: msg.enabled,
        senderHasTab: Boolean(sender.tab),
        tabId: msg.tabId,
      });
      return;
    }

    if (type === 'automation:native-input') {
      const msg = raw as NativeInputRequest;
      void (async () => {
        const tabId = sender.tab?.id;
        const guardError = getNativeInputGuardError({ armedTabs, senderTabId: tabId });
        if (guardError) {
          safeSendResponse(sendResponse, {
            error: guardError,
            ok: false,
          } satisfies NativeInputResponse);
          return;
        }
        const result = await dispatchNativeInput(tabId, msg.payload);
        safeSendResponse(sendResponse, result);
      })();
      return true;
    }

    if (type !== 'automation:artifacts') {return;}

    const msg = raw as ArtifactsRequest;
    void (async () => {
      const tabId = sender.tab?.id;
      if (!tabId) {
        safeSendResponse(sendResponse, { error: 'Missing sender tab', ok: false });
        return;
      }

      const payload = (msg.payload ?? {}) as {
        fileName?: string;
        content?: unknown;
        mimeType?: string;
        asBase64?: boolean;
      };

      try {
        if (msg.action === 'listArtifacts') {
          const records = await listArtifacts(tabId);
          safeSendResponse(sendResponse, {
            ok: true,
            result: records.map(({ fileName, mimeType, size, updatedAt }) => ({
              fileName,
              mimeType,
              size,
              updatedAt,
            })),
          });
          return;
        }

        if (msg.action === 'getArtifact') {
          if (!payload.fileName) {throw new Error('Missing fileName');}
          const record = await getArtifactRecord(tabId, payload.fileName);
          if (!record) {throw new Error(`Artifact not found: ${payload.fileName}`);}
          const isText =
            record.mimeType.startsWith('text/') ||
            record.mimeType === 'application/json' ||
            record.fileName.endsWith('.json');
          const value = payload.asBase64 ? record : (isText ? parseArtifact(record) : record);
          safeSendResponse(sendResponse, { ok: true, result: value });
          return;
        }

        if (msg.action === 'createOrUpdateArtifact') {
          if (!payload.fileName) {throw new Error('Missing fileName');}
          const record = await upsertArtifact(tabId, {
            content: payload.content,
            contentBase64:
              typeof payload.content === 'object' &&
              payload.content &&
              'contentBase64' in payload.content
                ? (payload.content as { contentBase64?: string }).contentBase64
                : undefined,
            fileName: payload.fileName,
            mimeType: payload.mimeType,
          });
          safeSendResponse(sendResponse, {
            ok: true,
            result: {
              fileName: record.fileName,
              mimeType: record.mimeType,
              size: record.size,
              updatedAt: record.updatedAt,
            },
          });
          return;
        }

        if (msg.action === 'deleteArtifact') {
          if (!payload.fileName) {throw new Error('Missing fileName');}
          const deleted = await deleteArtifact(tabId, payload.fileName);
          safeSendResponse(sendResponse, { ok: true, result: { ok: deleted } });
          return;
        }

        throw new Error(`Unknown artifact action: ${msg.action ?? 'unknown'}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        safeSendResponse(sendResponse, { error: message, ok: false });
      }
    })();
    return true;
  };
}
