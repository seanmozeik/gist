import { describe, expect, it, vi } from 'vitest';

import { createSidepanelInteractionRuntime } from '../apps/chrome-extension/src/entrypoints/sidepanel/interaction-runtime';

function createHarness() {
  const sent: object[] = [];
  const state = {
    chatStreaming: false,
    cleared: 0,
    customHidden: false,
    height: '',
    queueLength: 0,
    rawInput: '',
    restored: '',
  };
  const spies = {
    blurCustomModel: vi.fn(),
    clearInlineError: vi.fn(),
    enqueueChatMessage: vi.fn(() => true),
    focusCustomModel: vi.fn(),
    maybeSendQueuedChat: vi.fn(),
    retryChat: vi.fn(),
    setLastAction: vi.fn(),
    startChatMessage: vi.fn(),
    updateModelRowUI: vi.fn(),
  };
  const typographyController = {
    apply: vi.fn(),
    clampFontSize: vi.fn((value: number) => value),
    clampLineHeight: vi.fn((value: number) => value),
    getCurrentFontSize: vi.fn(() => 14),
    getCurrentLineHeight: vi.fn(() => 1.4),
    setCurrentFontSize: vi.fn(),
    setCurrentLineHeight: vi.fn(),
  };
  const patchSettings = vi.fn(async (value: Record<string, unknown>) => ({
    fontFamily: 'IBM Plex Sans',
    fontSize: typeof value.fontSize === 'number' ? value.fontSize : 15,
    lineHeight: typeof value.lineHeight === 'number' ? value.lineHeight : 1.5,
  }));
  const runtime = createSidepanelInteractionRuntime({
    blurCustomModel: spies.blurCustomModel,
    chatEnabled: vi.fn(() => true),
    clearChatInput: vi.fn(() => {
      state.rawInput = '';
      state.cleared += 1;
    }),
    clearInlineError: spies.clearInlineError,
    enqueueChatMessage: spies.enqueueChatMessage,
    focusCustomModel: spies.focusCustomModel,
    getChatInputScrollHeight: vi.fn(() => 180),
    getInputModeOverride: vi.fn(() => 'video'),
    getQueuedChatCount: vi.fn(() => state.queueLength),
    getRawChatInput: vi.fn(() => state.rawInput),
    isChatStreaming: vi.fn(() => state.chatStreaming),
    isCustomModelHidden: vi.fn(() => state.customHidden),
    maybeSendQueuedChat: spies.maybeSendQueuedChat,
    patchSettings,
    readCurrentModelValue: vi.fn(() => 'openai/gpt-5.4'),
    restoreChatInput: vi.fn((value: string) => {
      state.restored = value;
      state.rawInput = value;
    }),
    retryChat: spies.retryChat,
    sendRawMessage: async (message) => {
      sent.push(message);
    },
    setChatInputHeight: vi.fn((value: string) => {
      state.height = value;
    }),
    setLastAction: spies.setLastAction,
    startChatMessage: spies.startChatMessage,
    typographyController,
    updateModelRowUI: spies.updateModelRowUI,
  });
  return { patchSettings, runtime, sent, spies, state, typographyController };
}

describe('sidepanel interaction runtime', () => {
  it('tracks gist and agent sends', async () => {
    const harness = createHarness();

    await harness.runtime.send({ type: 'panel:gist' });
    await harness.runtime.send({ type: 'panel:agent' });

    expect(harness.sent).toEqual([{ type: 'panel:gist' }, { type: 'panel:agent' }]);
    expect(harness.spies.setLastAction).toHaveBeenNthCalledWith(1, 'gist');
    expect(harness.spies.setLastAction).toHaveBeenNthCalledWith(2, 'chat');
  });

  it('sends gist with refresh and input override', async () => {
    const harness = createHarness();

    harness.runtime.sendGist({ refresh: true });
    await Promise.resolve();

    expect(harness.sent).toEqual([{ inputMode: 'video', refresh: true, type: 'panel:gist' }]);
  });

  it('retries chat or gist based on last action', async () => {
    const harness = createHarness();

    harness.runtime.retryLastAction('chat');
    harness.runtime.retryLastAction('gist');
    await Promise.resolve();

    expect(harness.spies.retryChat).toHaveBeenCalledTimes(1);
    expect(harness.sent).toEqual([{ inputMode: 'video', refresh: true, type: 'panel:gist' }]);
  });

  it('starts chat immediately when idle', () => {
    const harness = createHarness();
    harness.state.rawInput = '  hello there  ';

    harness.runtime.sendChatMessage();

    expect(harness.state.cleared).toBe(1);
    expect(harness.spies.startChatMessage).toHaveBeenCalledWith('hello there');
  });

  it('restores chat input when queueing fails', () => {
    const harness = createHarness();
    harness.state.rawInput = 'queued';
    harness.state.chatStreaming = true;
    harness.spies.enqueueChatMessage.mockReturnValueOnce(false);

    harness.runtime.sendChatMessage();

    expect(harness.state.restored).toBe('queued');
    expect(harness.state.height).toBe('120px');
    expect(harness.spies.maybeSendQueuedChat).not.toHaveBeenCalled();
  });

  it('kicks queued chat when not streaming but queue already has items', () => {
    const harness = createHarness();
    harness.state.rawInput = 'queued';
    harness.state.queueLength = 1;

    harness.runtime.sendChatMessage();

    expect(harness.spies.enqueueChatMessage).toHaveBeenCalledWith('queued');
    expect(harness.spies.maybeSendQueuedChat).toHaveBeenCalledTimes(1);
  });

  it('updates typography and model settings', async () => {
    const harness = createHarness();

    harness.runtime.bumpFontSize(2);
    harness.runtime.bumpLineHeight(0.2);
    harness.runtime.persistCurrentModel({ blurCustom: true, focusCustom: true });
    await Promise.resolve();
    await Promise.resolve();

    expect(harness.patchSettings).toHaveBeenCalledWith({ fontSize: 16 });
    expect(harness.patchSettings).toHaveBeenCalledWith({ lineHeight: 1.599_999_999_999_999_9 });
    expect(harness.patchSettings).toHaveBeenCalledWith({ model: 'openai/gpt-5.4' });
    expect(harness.typographyController.apply).toHaveBeenCalled();
    expect(harness.spies.focusCustomModel).toHaveBeenCalledTimes(1);
    expect(harness.spies.blurCustomModel).toHaveBeenCalledTimes(1);
  });

  it('skips hidden custom model focus and disabled chat input', () => {
    const harness = createHarness();
    harness.state.customHidden = true;
    harness.runtime.persistCurrentModel({ focusCustom: true });
    harness.state.rawInput = 'hello';
    const disabledRuntime = createSidepanelInteractionRuntime({
      blurCustomModel: vi.fn(),
      chatEnabled: vi.fn(() => false),
      clearChatInput: vi.fn(),
      clearInlineError: vi.fn(),
      enqueueChatMessage: vi.fn(() => true),
      focusCustomModel: vi.fn(),
      getChatInputScrollHeight: vi.fn(() => 40),
      getInputModeOverride: vi.fn(() => null),
      getQueuedChatCount: vi.fn(() => 0),
      getRawChatInput: vi.fn(() => 'hello'),
      isChatStreaming: vi.fn(() => false),
      isCustomModelHidden: vi.fn(() => true),
      maybeSendQueuedChat: vi.fn(),
      patchSettings: harness.patchSettings,
      readCurrentModelValue: vi.fn(() => 'openai/gpt-5.4'),
      restoreChatInput: vi.fn(),
      retryChat: vi.fn(),
      sendRawMessage: async () => {
        /* Empty */
      },
      setChatInputHeight: vi.fn(),
      setLastAction: vi.fn(),
      startChatMessage: vi.fn(),
      typographyController: harness.typographyController,
      updateModelRowUI: vi.fn(),
    });

    disabledRuntime.sendChatMessage();

    expect(harness.spies.focusCustomModel).not.toHaveBeenCalled();
  });
});
