const canonicalHost = 'gist.sh';
const redirectHostnames = new Set(['gist.is', 'www.gist.is']);

const maybeRedirect = () => {
  try {
    const { hostname, pathname, search, hash } = globalThis.location;
    if (!redirectHostnames.has(hostname)) {
      return;
    }
    const target = `https://${canonicalHost}${pathname}${search}${hash}`;
    globalThis.location.replace(target);
  } catch {
    // Ignore
  }
};

const highlightNav = () => {
  const path = globalThis.location.pathname;
  const isDocs = path.includes('/docs/');
  const navDocs = document.querySelector('a[data-nav="docs"]');
  const navHome = document.querySelector('a[data-nav="home"]');
  if (navDocs && isDocs) {
    navDocs.setAttribute('aria-current', 'page');
  }
  if (navHome && !isDocs) {
    navHome.setAttribute('aria-current', 'page');
  }

  const sideLinks = document.querySelectorAll('.side a[href]');
  for (const a of sideLinks) {
    const href = a.getAttribute('href') ?? '';
    if (!href) {
      continue;
    }
    const normalized = href.replace(/^\.\//, '');
    if (path.endsWith(normalized)) {
      a.setAttribute('aria-current', 'page');
    }
  }
};

const wireCopyButtons = () => {
  const buttons = document.querySelectorAll('[data-copy]');
  const handleCopyClick = async (button) => {
    const selector = button.dataset.copy;
    const target = selector ? document.querySelector(selector) : null;
    const text = target?.textContent?.trim() ?? '';
    if (!text) {
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      const prev = button.textContent ?? '';
      button.textContent = 'Copied';
      button.dataset.copied = '1';
      globalThis.setTimeout(() => {
        button.textContent = prev;
        delete button.dataset.copied;
      }, 900);
    } catch {
      // Ignore
    }
  };
  for (const button of buttons) {
    button.addEventListener('click', () => {});
  }
};

const reveal = () => {
  const items = document.querySelectorAll('.reveal');
  let i = 0;
  for (const el of items) {
    const delay = Math.min(380, i * 70);
    globalThis.setTimeout(() => {
      el.classList.add('is-on');
    }, delay);
    i += 1;
  }
};

maybeRedirect();
highlightNav();
wireCopyButtons();
reveal();
