import { loadSettings, saveSettings } from '../../lib/settings';
import { clearActionLog, readActionLog } from '../../lib/action-log';
import { ENDPOINT_PRESETS, isPresetName, resolveEndpoint } from '../../lib/endpoints';
import type { EndpointPreset, Settings } from '../../lib/types';

type Lang = 'en' | 'zh';

interface Strings {
  subtitle: string;
  lblEndpoint: string;
  lblModel: string;
  lblMode: string;
  lblScope: string;
  lblStatus: string;
  lblDebug: string;
  debugHint: string;
  debug: string;
  scan: string;
  settings: string;
  scopeReplies: string;
  scopeAll: string;
  on: string;
  off: string;
  prefilterOnly: string;
  presetJev: string;
  presetOpenAI: string;
  presetCustom: string;
  modeManual: string;
  modeFold: string;
  logTitle: string;
  logClear: string;
  logEmpty: string;
  undo: string;
  undone: string;
  undoOk: string;
  undoFail: string;
  undoNoTab: string;
  mute: string;
  block: string;
  notXTab: string;
  noContentScript: string;
  scanning: string;
  scanned: (n: number) => string;
  scannedZero: string;
  scanFailed: string;
}

const STR: Record<Lang, Strings> = {
  en: {
    subtitle: 'Fold AI-slop / bot replies on X',
    lblEndpoint: 'Endpoint',
    lblModel: 'Model',
    lblMode: 'Mode',
    lblScope: 'Scope',
    lblStatus: 'Status',
    lblDebug: 'Debug mode',
    debugHint: 'AI rate on every post · read-only, may call the model',
    debug: 'Debug',
    scan: 'Scan current page',
    settings: 'Options',
    scopeReplies: 'Replies only',
    scopeAll: 'Timeline + replies',
    on: 'Enabled',
    off: 'Disabled',
    prefilterOnly: 'Prefilter only',
    presetJev: 'TypeSafe / Jev',
    presetOpenAI: 'OpenAI Decisions',
    presetCustom: 'Custom',
    modeManual: 'Manual',
    modeFold: 'Auto fold',
    logTitle: 'Recent automatic actions',
    logClear: 'Clear',
    logEmpty: 'None yet',
    undo: 'Undo',
    undone: 'undone',
    undoOk: 'Unblocked and whitelisted',
    undoFail: 'Undo failed',
    undoNoTab: 'Open an x.com tab to undo',
    mute: 'Mute',
    block: 'Block',
    notXTab: 'This tab is not x.com — open a profile or a post first.',
    noContentScript:
      'No content script in this tab. Reload the tab once after installing or reloading the extension.',
    scanning: 'Scanning…',
    scanned: (n: number) => `Scanned ${n} post${n === 1 ? '' : 's'}.`,
    scannedZero:
      'Nothing to scan here. On the home timeline only replies are scored unless you switch Scope to "Timeline + replies".',
    scanFailed: 'Scan failed',
  },
  zh: {
    subtitle: '折叠 X 上的 AI 注水 / 机器人回复',
    lblEndpoint: '端点',
    lblModel: '模型',
    lblMode: '模式',
    lblScope: '范围',
    lblStatus: '状态',
    lblDebug: '调试模式',
    debugHint: '每条推文都显示 AI 率 · 只读，可能调用模型',
    debug: '调试',
    scan: '扫描当前页',
    settings: '选项',
    scopeReplies: '仅回复',
    scopeAll: '时间线 + 回复',
    on: '已启用',
    off: '已停用',
    prefilterOnly: '仅预筛',
    presetJev: 'TypeSafe / Jev',
    presetOpenAI: 'OpenAI Decisions',
    presetCustom: '自定义',
    modeManual: '手动',
    modeFold: '自动折叠',
    logTitle: '最近的自动动作',
    logClear: '清空',
    logEmpty: '暂无',
    undo: '撤销',
    undone: '已撤销',
    undoOk: '已解除屏蔽并加入白名单',
    undoFail: '撤销失败',
    undoNoTab: '需要打开一个 x.com 标签页才能撤销',
    mute: '静音',
    block: '屏蔽',
    notXTab: '当前标签不是 x.com —— 先打开一个用户页或推文页。',
    noContentScript: '这个标签里没有 content script。安装或重载扩展后，请刷新一次该标签页。',
    scanning: '扫描中…',
    scanned: (n: number) => `已扫描 ${n} 条。`,
    scannedZero:
      '这里没有可扫描的内容。首页时间线在「仅回复」模式下只处理回复，想扫主帖请把范围改成「时间线 + 回复」。',
    scanFailed: '扫描失败',
  },
};

function lang(): Lang {
  return (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function endpointLabel(settings: Settings, t: Strings): string {
  const preset: EndpointPreset = settings.endpointPreset;
  if (preset === 'jev-official') return t.presetJev;
  if (preset === 'openai-official') return t.presetOpenAI;
  // Custom endpoints show the host so two different ones stay distinguishable.
  try {
    return `${t.presetCustom} · ${new URL(settings.upstreamBaseUrl).host}`;
  } catch {
    return t.presetCustom;
  }
}

function note(message: string, warn = false) {
  const el = $('note');
  el.textContent = message;
  el.classList.toggle('warn', warn);
}

function applyLabels(t: Strings) {
  $('subtitle').textContent = t.subtitle;
  $('lblEndpoint').textContent = t.lblEndpoint;
  $('lblModel').textContent = t.lblModel;
  $('lblMode').textContent = t.lblMode;
  $('lblScope').textContent = t.lblScope;
  $('lblStatus').textContent = t.lblStatus;
  $('lblDebug').textContent = t.lblDebug;
  $('debugHint').textContent = t.debugHint;
  $('scan').textContent = t.scan;
  $('settings').textContent = t.settings;
}

function render(settings: Settings, t: Strings) {
  const endpoint = resolveEndpoint(settings);
  $('endpoint').textContent = endpointLabel(settings, t);
  $('endpoint').title = `${endpoint.baseUrl}${endpoint.path}`;
  $('model').textContent = endpoint.model || '—';
  // Strict is shelved; loadSettings downgrades any stored value to auto fold.
  $('mode').textContent = settings.scanMode === 'manual' ? t.modeManual : t.modeFold;
  $('scope').textContent = settings.scanScope === 'replies-only' ? t.scopeReplies : t.scopeAll;
  const state = [
    settings.prefilterOnly ? t.prefilterOnly : '',
    settings.debugMode ? t.debug : '',
  ].filter(Boolean);
  $('status').textContent = !settings.enabled ? t.off : [t.on, ...state].join(' · ');
  ($('debugMode') as HTMLInputElement).checked = settings.debugMode;
}

function isXUrl(url: string | undefined): boolean {
  if (!url) return true; // tab URL not readable (no tabs permission): let the message decide
  return /^https:\/\/(x|twitter)\.com\//.test(url);
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scan(t: Strings) {
  const button = $('scan') as HTMLButtonElement;
  button.disabled = true;
  note(t.scanning);
  try {
    const tab = await activeTab();
    if (!tab?.id) {
      note(t.scanFailed, true);
      return;
    }
    if (!isXUrl(tab.url)) {
      note(t.notXTab, true);
      return;
    }
    const resp = (await chrome.tabs.sendMessage(tab.id, {
      type: 'ANTI_SLOP_SCAN_NOW',
    })) as { ok?: boolean; scanned?: number } | undefined;
    const count = typeof resp?.scanned === 'number' ? resp.scanned : 0;
    if (resp?.ok && count > 0) {
      note(t.scanned(count));
    } else if (resp?.ok) {
      note(t.scannedZero, true);
    } else {
      note(t.scanFailed, true);
    }
  } catch {
    note(t.noContentScript, true);
  } finally {
    button.disabled = false;
  }
}

function two(n: number): string {
  return String(n).padStart(2, '0');
}

async function undoBlock(ts: number, handle: string, t: Strings): Promise<void> {
  const note = $('undoNote');
  note.classList.remove('warn');
  note.textContent = '…';
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'ANTI_SLOP_UNDO_BLOCK',
      ts,
      handle,
    })) as { ok?: boolean; error?: string } | undefined;
    if (res?.ok) {
      note.textContent = t.undoOk;
      await renderLog(t);
      return;
    }
    note.classList.add('warn');
    note.textContent = res?.error === 'no-x-tab' ? t.undoNoTab : t.undoFail;
  } catch {
    note.classList.add('warn');
    note.textContent = t.undoFail;
  }
}

async function renderLog(t: Strings): Promise<void> {
  const entries = await readActionLog();
  const log = $('log');
  const list = $('logList');
  $('lblLog').textContent = t.logTitle;
  $('clearLog').textContent = t.logClear;

  if (entries.length === 0) {
    log.hidden = false;
    list.innerHTML = `<li><span class="who">${t.logEmpty}</span></li>`;
    return;
  }

  log.hidden = false;
  list.innerHTML = entries
    .slice(0, 8)
    .map((e) => {
      const when = new Date(e.ts);
      const time = `${two(when.getHours())}:${two(when.getMinutes())}`;
      const pct = Math.round(e.score * 100);
      const label = e.action === 'block' ? t.block : t.mute;
      const canUndo = e.action === 'block' && e.ok;
      const tail = !canUndo
        ? ''
        : e.undone
          ? `<span class="done">${t.undone}</span>`
          : `<button class="act" data-ts="${e.ts}" data-handle="${escapeHtml(e.handle)}">${t.undo}</button>`;
      return `<li class="${e.ok ? '' : 'fail'}"><span class="who">${label} @${escapeHtml(
        e.handle,
      )} · ${pct}%</span><span class="when">${time}</span>${tail}</li>`;
    })
    .join('');

  list.querySelectorAll<HTMLButtonElement>('button.act').forEach((btn) => {
    btn.addEventListener('click', () => {
      const ts = Number(btn.dataset.ts);
      const handle = btn.dataset.handle || '';
      void undoBlock(ts, handle, t);
    });
  });
}

async function main() {
  const t = STR[lang()];
  applyLabels(t);

  const settings = await loadSettings();
  render(settings, t);

  if (isPresetName(settings.endpointPreset)) {
    $('endpoint').title = `${ENDPOINT_PRESETS[settings.endpointPreset].baseUrl}${
      ENDPOINT_PRESETS[settings.endpointPreset].path
    }`;
  }

  await renderLog(t);

  $('debugMode').addEventListener('change', (ev) => {
    const on = (ev.target as HTMLInputElement).checked;
    // Persisted immediately: the content script listens on storage and swaps
    // every mounted card between the normal policy and read-only scores.
    void saveSettings({ debugMode: on }).then((s) => render(s, t));
  });

  $('scan').addEventListener('click', () => void scan(t));
  $('settings').addEventListener('click', () => void chrome.runtime.openOptionsPage());
  $('clearLog').addEventListener('click', () => {
    void clearActionLog().then(() => renderLog(t));
  });
}

void main();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
