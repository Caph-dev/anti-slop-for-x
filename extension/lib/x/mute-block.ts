/**
 * Mute / Block — ONLY on explicit user click.
 *
 * Strategy (in order):
 * 1) Prefer clicking X's native ··· → Mute/Block menu (same UX as manual).
 * 2) Fallback: same-origin X web API using logged-in cookies (ct0 + bearer from page).
 *
 * Headless / automation note: native menu clicks need a real interactive page;
 * cookie API fallback still requires an authenticated x.com session in this browser.
 */

function getCookie(name: string): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function getBearerFromPage(): string | null {
  // X embeds a public bearer; prefer any Authorization used by the SPA.
  // Fallback to the well-known public guest bearer used by the web client.
  const PUBLIC =
    'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i) || '';
      if (/bearer|auth/i.test(k)) {
        const v = localStorage.getItem(k);
        if (v && v.startsWith('AAAA')) return v;
      }
    }
  } catch {
    /* ignore */
  }
  return PUBLIC;
}

async function xApiPost(path: string, body: URLSearchParams): Promise<{ ok: boolean; status: number; detail: string }> {
  const ct0 = getCookie('ct0');
  if (!ct0) return { ok: false, status: 0, detail: 'Missing ct0 cookie — are you logged into X?' };
  const bearer = getBearerFromPage();
  const res = await fetch(`https://x.com/i/api${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: {
      authorization: `Bearer ${bearer}`,
      'x-csrf-token': ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  const detail = await res.text().catch(() => '');
  return { ok: res.ok, status: res.status, detail: detail.slice(0, 500) };
}

/** Try opening the tweet's caret menu and clicking a menuitem by text. */
export async function clickNativeMenuAction(
  article: HTMLElement,
  action: 'Mute' | 'Block',
): Promise<boolean> {
  const caret =
    (article.querySelector('[data-testid="caret"]') as HTMLElement | null) ||
    (article.querySelector('[aria-label="More"]') as HTMLElement | null);
  if (!caret) return false;
  caret.click();
  await new Promise((r) => setTimeout(r, 250));

  const items = Array.from(document.querySelectorAll('[role="menuitem"]')) as HTMLElement[];
  const target = items.find((el) => {
    const t = (el.textContent || '').trim();
    return t.includes(action) || t.includes(action === 'Mute' ? '静音' : '屏蔽');
  });
  if (!target) {
    // dismiss
    document.body.click();
    return false;
  }
  target.click();
  // Block often needs a confirm dialog
  if (action === 'Block') {
    await new Promise((r) => setTimeout(r, 300));
    const confirm =
      (document.querySelector('[data-testid="confirmationSheetConfirm"]') as HTMLElement | null) ||
      Array.from(document.querySelectorAll('[role="button"]')).find((b) =>
        /block|屏蔽/i.test(b.textContent || ''),
      );
    (confirm as HTMLElement | undefined)?.click();
  }
  return true;
}

export async function muteUser(opts: {
  article: HTMLElement;
  screenName: string;
  userId?: string | null;
}): Promise<{ ok: boolean; method: string; detail?: string }> {
  if (await clickNativeMenuAction(opts.article, 'Mute')) {
    return { ok: true, method: 'native-menu' };
  }
  const params = new URLSearchParams();
  if (opts.userId) params.set('user_id', opts.userId);
  else params.set('screen_name', opts.screenName);
  const res = await xApiPost('/1.1/mutes/users/create.json', params);
  return { ok: res.ok, method: 'api-1.1', detail: res.detail || `HTTP ${res.status}` };
}

export async function blockUser(opts: {
  article: HTMLElement;
  screenName: string;
  userId?: string | null;
}): Promise<{ ok: boolean; method: string; detail?: string }> {
  if (await clickNativeMenuAction(opts.article, 'Block')) {
    return { ok: true, method: 'native-menu' };
  }
  const params = new URLSearchParams();
  if (opts.userId) params.set('user_id', opts.userId);
  else params.set('screen_name', opts.screenName);
  const res = await xApiPost('/1.1/blocks/create.json', params);
  return { ok: res.ok, method: 'api-1.1', detail: res.detail || `HTTP ${res.status}` };
}
