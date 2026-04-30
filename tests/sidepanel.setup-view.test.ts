import { describe, expect, it } from 'vitest';

import { installStepsHtml } from '../apps/chrome-extension/src/entrypoints/sidepanel/setup-view';

describe('sidepanel setup view', () => {
  it('renders the official Homebrew formula for mac setup', () => {
    const html = installStepsHtml({ headline: 'Setup', platformKind: 'mac', token: 'token' });

    expect(html).toContain('brew install gist');
    expect(html).not.toContain('steipete/tap/gist');
  });

  it('shows npm guidance for non-mac setup instead of the old tap warning', () => {
    const html = installStepsHtml({ headline: 'Setup', platformKind: 'linux', token: 'token' });

    expect(html).toContain('npm i -g @seanmozeik/gist');
    expect(html).toContain('NPM installs the CLI (requires Node.js).');
    expect(html).not.toContain('Homebrew tap is macOS-only.');
  });
});
