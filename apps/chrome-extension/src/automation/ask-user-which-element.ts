export interface ElementInfo {
  selector: string;
  xpath: string;
  html: string;
  tagName: string;
  attributes: Record<string, string>;
  text: string;
  boundingBox: { x: number; y: number; width: number; height: number };
}

export interface AskUserWhichElementArgs { message?: string }

export async function executeAskUserWhichElementTool(
  args: AskUserWhichElementArgs,
): Promise<ElementInfo> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) {throw new Error('No active tab');}

  const ensureInjected = async () => {
    try {
      await chrome.scripting.executeScript({
        files: ['content-scripts/automation.js'],
        target: { tabId: tab.id },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        message.toLowerCase().includes('cannot access') || message.toLowerCase().includes('denied')
          ? `Chrome blocked content access (${message}). Check extension “Site access” → “On all sites”, then reload the tab.`
          : `Failed to inject automation content script (${message}). Check extension “Site access”, then reload the tab.`, { cause: err },
      );
    }
  };

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = (await chrome.tabs.sendMessage(tab.id, {
        message: args.message ?? null,
        type: 'automation:pick-element',
      })) as { ok: boolean; result?: ElementInfo; error?: string };

      if (!response.ok || !response.result) {
        throw new Error(response.error || 'Element picker failed');
      }

      return response.result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const noReceiver =
        message.includes('Receiving end does not exist') ||
        message.includes('Could not establish connection');
      if (noReceiver) {
        await ensureInjected();
        await new Promise((r) => setTimeout(r, 120));
        continue;
      }
      throw error;
    }
  }

  throw new Error('Element picker not available');
}
