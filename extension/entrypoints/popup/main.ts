import { loadSettings, saveSettingsViaBackground, settingsKey } from '../../lib/settings';
import { clearActionLog, readActionLog } from '../../lib/action-log';
import { resolveEndpoint } from '../../lib/endpoints';
import { hasOriginAccess } from '../../lib/permissions';
import { configProblem, type ConfigProblem } from '../../lib/scorer';
import { outcomeLabel } from '../../lib/debug';
import { uiT } from '../../lib/i18n-ui';
import type { DiagnosticsSnapshot } from '../../lib/diagnostics';
import type { Settings } from '../../lib/types';

const EN = {
  behavior: 'Possible low-quality posts',
  mode: 'What to do with possible low-quality posts',
  modeManual: 'Mark only',
  modeShadow: 'Record only',
  manualHint: 'Marks possible engagement bait and similar posts with quoted evidence. Nothing folds unless you click Fold or set a hide rule.',
  shadowHint: 'Records results for this tab only and never changes posts. Earlier “Auto fold” settings work this way too: automatic folding needs an independent evaluation first.',
  scope: 'Scan scope',
  scopeReplies: 'Replies only',
  scopeAll: 'Timeline + replies',
  debug: 'Debug mode',
  debugHint: 'Shows each checked post’s recognition state in Mark only. Debug scans even when auto-scan is off, but respects scope and excluded posts.',
  enable: 'Enable Anti Slop for X',
  running: 'Running on X',
  debugging: 'Debug mode is on',
  paused: 'Paused',
  pausedHint: 'Your preferences are kept. Turn on to resume.',
  debugStatusHint: 'Diagnostic badges are shown. Your hide rules still apply.',
  autoHint: 'Checks new posts as you browse.',
  manualScanHint: 'Scan the current page when you are ready.',
  scan: 'Scan current page',
  settings: 'Model & more settings',
  cfg_user_opted_out: 'Model use is off · nothing is sent',
  cfg_unsupported_protocol: (name: string) => `${name} can’t return checkable evidence · choose OpenAI Responses`,
  cfg_missing_key: 'Add an API key to recognize posts',
  cfg_missing_model: 'Choose a model in settings',
  cfg_invalid_config: 'The endpoint URL is not usable',
  cfg_permission: 'Chrome host access is missing · open settings to grant it',
  cfg_checking_permission: 'Checking Chrome host access…',
  presetJev: 'TypeSafe / Jev',
  presetOpenAI: 'OpenAI Decisions',
  presetResponses: 'OpenAI Responses',
  presetCustom: 'Custom',
  autoSaved: 'Saves automatically',
  saving: 'Saving…',
  saved: 'Saved',
  saveFailed: 'Couldn’t save. Please try again.',
  loading: 'Loading…',
  loadFailed: 'Couldn’t load preferences',
  settingsFailed: 'Couldn’t open settings. Please try again.',
  scanHint: 'Uses your current mode and scope. Requests use your own key and may incur charges.',
  pausedScanHint: 'Turn on Anti Slop to scan this page.',
  notXTab: 'Open an x.com tab to scan posts.',
  noContentScript: 'Reload the X tab after installing or reloading the extension.',
  scanning: 'Scanning…',
  scanned: (n: number) => `Checked ${n} post${n === 1 ? '' : 's'}. Details are in “This tab’s record”.`,
  scannedZero: 'No new posts to check in this scope. Try scrolling or changing the scope.',
  scanFailed: 'Couldn’t scan this page. Please try again.',
  diagTitle: 'This tab’s record',
  diagHint: 'Kept in this tab’s memory only and gone when the tab reloads. Post IDs are used for deduplication; post text, accounts and model explanations are not recorded.',
  diagEmpty: 'Nothing recorded in this tab yet.',
  diagNotX: 'Open an x.com tab to see its record.',
  diagUnavailable: 'Reload the X tab to see its record.',
  diagTotal: (n: number) => `${n} post${n === 1 ? '' : 's'}`,
  diagWouldFold: 'Model targets under an automatic policy (model folding is off)',
  diagMarked: 'Marked on the page',
  diagReported: 'Reported as inaccurate',
  diagCalls: 'Model request attempts',
  diagMeanLatency: 'Mean response time (ms)',
  diagPauseRate: 'Automatic checks paused: the provider is rate limiting',
  diagPauseAuth: 'Automatic checks paused: the API key was rejected',
  logTitle: 'Earlier automatic actions',
  logHint: 'Mutes and blocks made automatically by earlier versions. Automatic actions are off now.',
  logClear: 'Clear',
  logClearHint: 'Clear history without undoing any actions',
  logClearConfirm: 'Confirm clear',
  logEmpty: 'No automatic mutes or blocks.',
  logEmptySummary: 'None',
  logCount: (n: number) => `${n} action${n === 1 ? '' : 's'}`,
  logFailed: 'Couldn’t load action history.',
  logClearFailed: 'Couldn’t clear history. Please try again.',
  undo: 'Undo',
  undoHint: 'Unblock this account and add it to your keep list',
  undone: 'Undone',
  undoOk: 'Unblocked and added to your keep list.',
  undoFail: 'Couldn’t undo. Please try again.',
  undoNoTab: 'Open an x.com tab to undo this block.',
  mute: 'Mute',
  block: 'Block',
  failed: 'Failed',
};

type Strings = typeof EN;
const ZH: Strings = {
  behavior: '可能的低质量内容',
  mode: '发现可能的低质量内容时',
  modeManual: '仅标记',
  modeShadow: '仅记录',
  manualHint: '给可能的诱导互动等低质量内容加标记，并附原文引用。除非你点“折叠”或设置了隐藏规则，否则不会折叠任何内容。',
  shadowHint: '只在本标签页记录结果，不改动任何帖子。旧版的“自动折叠”设置也按此运行：自动折叠需要先通过独立评估。',
  scope: '扫描范围',
  scopeReplies: '仅回复',
  scopeAll: '时间线 + 回复',
  debug: '调试模式',
  debugHint: '在“仅标记”下显示识别状态。即使关闭自动扫描，调试仍会扫描，但遵守范围和不发送偏好。',
  enable: '启用 Anti Slop for X',
  running: '正在 X 上运行',
  debugging: '调试中',
  paused: '已暂停',
  pausedHint: '偏好已保留，启用后继续运行。',
  debugStatusHint: '显示诊断标记，你的隐藏规则仍然生效。',
  autoHint: '浏览时自动检查新内容。',
  manualScanHint: '按需扫描当前页面。',
  scan: '扫描当前页',
  settings: '模型与更多设置',
  cfg_user_opted_out: '已关闭模型调用 · 不发送任何内容',
  cfg_unsupported_protocol: (name) => `${name} 无法返回可核对的证据 · 请选择 OpenAI Responses`,
  cfg_missing_key: '填写 API Key 后才能识别内容',
  cfg_missing_model: '请在设置里选择模型',
  cfg_invalid_config: '端点 URL 无法使用',
  cfg_permission: '缺少 Chrome 站点访问权限 · 请打开设置申请',
  cfg_checking_permission: '正在检查 Chrome 站点访问权限…',
  presetJev: 'TypeSafe / Jev',
  presetOpenAI: 'OpenAI Decisions',
  presetResponses: 'OpenAI Responses',
  presetCustom: '自定义',
  autoSaved: '更改即时保存',
  saving: '保存中…',
  saved: '已保存',
  saveFailed: '保存失败，请重试',
  loading: '正在读取设置…',
  loadFailed: '无法读取设置',
  settingsFailed: '无法打开设置，请重试。',
  scanHint: '按当前模式与范围扫描。请求使用你自己的 Key，可能产生费用。',
  pausedScanHint: '启用扩展后即可扫描当前页。',
  notXTab: '请先打开 x.com 页面，再扫描推文。',
  noContentScript: '安装或重载扩展后，请刷新一次 X 标签页。',
  scanning: '扫描中…',
  scanned: (n) => `已检查 ${n} 条内容，详情见“本标签页记录”。`,
  scannedZero: '当前范围内没有新内容可检查，可滚动页面或调整范围。',
  scanFailed: '扫描失败，请重试。',
  diagTitle: '本标签页记录',
  diagHint: '只保存在本标签页的内存里，刷新即清空。帖子 ID 用于去重；不记录原文、账号或模型说明。',
  diagEmpty: '本标签页还没有记录。',
  diagNotX: '请打开 x.com 标签页查看记录。',
  diagUnavailable: '请刷新 X 标签页后查看记录。',
  diagTotal: (n) => `${n} 条`,
  diagWouldFold: '自动策略下的模型目标（模型自动折叠已关闭）',
  diagMarked: '已在页面上标记',
  diagReported: '被标为判断有误',
  diagCalls: '模型请求次数',
  diagMeanLatency: '平均响应时间（毫秒）',
  diagPauseRate: '自动检查已暂停：模型服务正在限流',
  diagPauseAuth: '自动检查已暂停：API Key 被拒绝',
  logTitle: '旧版自动操作记录',
  logHint: '旧版本自动执行的静音与屏蔽。现在已不再有自动操作。',
  logClear: '清空',
  logClearHint: '仅清空记录，不会撤销已执行的操作',
  logClearConfirm: '确认清空',
  logEmpty: '没有自动静音或屏蔽记录。',
  logEmptySummary: '无',
  logCount: (n) => `${n} 条记录`,
  logFailed: '无法读取操作记录。',
  logClearFailed: '清空失败，请重试。',
  undo: '撤销',
  undoHint: '解除屏蔽并将此账号加入保留名单',
  undone: '已撤销',
  undoOk: '已解除屏蔽，并加入保留名单。',
  undoFail: '撤销失败，请重试。',
  undoNoTab: '请先打开一个 x.com 标签页，再撤销屏蔽。',
  mute: '静音',
  block: '屏蔽',
  failed: '失败',
};

const language = (navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en';
const t = language === 'zh' ? ZH : EN;
const ui = uiT(language);
let settings: Settings | undefined;
let saving = false;
let scanning = false;
let tabIsX = true;
let settingsRevision = 0;
let storageReloadRevision = 0;
let permissionRevision = 0;
let hostPermission: 'checking' | 'granted' | 'missing' = 'checking';
let clearArmed = false;

function $(id: string): HTMLElement {
  return document.getElementById(id)!;
}

function input(id: string): HTMLInputElement {
  return $(id) as HTMLInputElement;
}

function note(message: string, warn = false) {
  $('note').textContent = message;
  $('note').classList.toggle('warn', warn);
}

function endpointLabel(s: Settings): string {
  if (s.endpointPreset === 'jev-official') return t.presetJev;
  if (s.endpointPreset === 'openai-official') return t.presetOpenAI;
  if (s.endpointPreset === 'openai-responses') return t.presetResponses;
  try {
    return new URL(s.upstreamBaseUrl).host;
  } catch {
    return t.presetCustom;
  }
}

function problemText(problem: ConfigProblem, s: Settings): string {
  switch (problem) {
    case 'unsupported_protocol': return t.cfg_unsupported_protocol(endpointLabel(s));
    case 'user_opted_out': return t.cfg_user_opted_out;
    case 'missing_key': return t.cfg_missing_key;
    case 'missing_model': return t.cfg_missing_model;
    case 'invalid_config': return t.cfg_invalid_config;
  }
}

function syncDisabled() {
  const ready = Boolean(settings);
  input('enabled').disabled = !ready || saving;
  input('debugMode').disabled = !ready || saving;
  ($('modeControls') as HTMLFieldSetElement).disabled = !ready || saving;
  ($('scanScope') as HTMLSelectElement).disabled = !ready || saving;
  ($('scan') as HTMLButtonElement).disabled = !ready || !settings?.enabled || !tabIsX || saving || scanning;
  $('scan').setAttribute('aria-busy', String(scanning));
  $('scanLabel').textContent = scanning ? t.scanning : t.scan;
  ($('settings') as HTMLButtonElement).disabled = saving;
}

function scanHint(s: Settings): { text: string; warn: boolean } {
  if (!s.enabled) return { text: t.pausedScanHint, warn: false };
  if (!tabIsX) return { text: t.notXTab, warn: false };
  const problem = configProblem(s);
  if (problem) return { text: problemText(problem, s), warn: problem !== 'user_opted_out' };
  if (hostPermission === 'missing') return { text: t.cfg_permission, warn: true };
  if (hostPermission === 'checking') return { text: t.cfg_checking_permission, warn: false };
  return { text: t.scanHint, warn: false };
}

function render(s: Settings) {
  document.body.dataset.state = !s.enabled ? 'paused' : s.debugMode ? 'debug' : 'running';
  $('statusTitle').textContent = !s.enabled ? t.paused : s.debugMode ? t.debugging : t.running;
  $('statusHint').textContent = !s.enabled
    ? t.pausedHint
    : s.debugMode ? t.debugStatusHint : s.autoScan ? t.autoHint : t.manualScanHint;
  input('enabled').checked = s.enabled;
  input('debugMode').checked = s.debugMode;
  document.querySelectorAll<HTMLInputElement>('input[name="scanMode"]').forEach((radio) => {
    radio.checked = radio.value === s.scanMode;
  });
  ($('scanScope') as HTMLSelectElement).value = s.scanScope;
  $('modeHint').textContent = s.scanMode === 'manual' ? t.manualHint : t.shadowHint;
  const endpoint = resolveEndpoint(s);
  const problem = configProblem(s);
  const revision = ++permissionRevision;
  hostPermission = 'checking';
  const connection = problem ? problemText(problem, s) : t.cfg_checking_permission;
  $('connectionDetail').textContent = connection;
  $('connectionDetail').title = connection;
  $('connectionDetail').classList.toggle('warn', Boolean(problem) && problem !== 'user_opted_out');
  $('settings').title = problem === 'user_opted_out' ? connection : `${endpoint.baseUrl}${endpoint.path}`;
  const hint = scanHint(s);
  note(hint.text, hint.warn);
  syncDisabled();
  if (!problem) {
    void hasOriginAccess(endpoint.baseUrl).then((allowed) => {
      if (revision !== permissionRevision) return;
      hostPermission = allowed ? 'granted' : 'missing';
      const label = allowed ? `${endpointLabel(s)} · ${endpoint.model}` : t.cfg_permission;
      $('connectionDetail').textContent = label;
      $('connectionDetail').title = label;
      $('connectionDetail').classList.toggle('warn', !allowed);
      if (!scanning) {
        const latest = scanHint(s);
        note(latest.text, latest.warn);
      }
    });
  }
}

async function persist(patch: Partial<Settings>) {
  if (!settings || saving) return;
  saving = true;
  settingsRevision++;
  $('saveStatus').textContent = t.saving;
  $('saveStatus').classList.remove('warn');
  syncDisabled();
  try {
    // The background serializes writes from every extension page.
    await saveSettingsViaBackground(patch);
    settings = await loadSettings();
    render(settings);
    $('saveStatus').textContent = t.saved;
  } catch {
    render(settings);
    $('saveStatus').textContent = t.saveFailed;
    $('saveStatus').classList.add('warn');
  } finally {
    saving = false;
    syncDisabled();
  }
}

function isXUrl(url: string | undefined): boolean {
  // Without a readable URL, let the content-script message establish availability.
  return !url || /^https:\/\/(x|twitter)\.com\//.test(url);
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function scan() {
  if (!settings?.enabled || saving || scanning) return;
  const revision = settingsRevision;
  scanning = true;
  note(t.scanning);
  syncDisabled();
  try {
    const tab = await activeTab();
    if (!tab?.id) {
      note(t.scanFailed, true);
      return;
    }
    tabIsX = isXUrl(tab.url);
    if (!tabIsX) {
      note(t.notXTab, true);
      return;
    }
    const resp = (await chrome.tabs.sendMessage(tab.id, {
      type: 'ANTI_SLOP_SCAN_NOW',
    })) as { ok?: boolean; scanned?: number } | undefined;
    if (revision !== settingsRevision) return;
    const problem = configProblem(settings);
    const allowed = problem ? null : await hasOriginAccess(resolveEndpoint(settings).baseUrl);
    if (revision !== settingsRevision) return;
    if (allowed !== null) {
      permissionRevision++;
      hostPermission = allowed ? 'granted' : 'missing';
      const connection = allowed ? `${endpointLabel(settings)} · ${resolveEndpoint(settings).model}` : t.cfg_permission;
      $('connectionDetail').textContent = connection;
      $('connectionDetail').title = connection;
      $('connectionDetail').classList.toggle('warn', !allowed);
    }
    const count = typeof resp?.scanned === 'number' ? resp.scanned : 0;
    if (resp?.ok && problem) note(problemText(problem, settings), problem !== 'user_opted_out');
    else if (resp?.ok && allowed === false) note(t.cfg_permission, true);
    else if (resp?.ok && count > 0) note(t.scanned(count));
    else if (resp?.ok) note(t.scannedZero);
    else note(t.scanFailed, true);
    if (($('diag') as HTMLDetailsElement).open) void renderDiagnostics();
  } catch {
    if (revision === settingsRevision) note(t.noContentScript, true);
  } finally {
    scanning = false;
    syncDisabled();
  }
}

function diagItem(label: string, count: number): HTMLLIElement {
  const li = document.createElement('li');
  const text = document.createElement('span');
  text.className = 'who';
  text.textContent = label;
  const value = document.createElement('span');
  value.className = 'diag-count';
  value.textContent = String(count);
  li.append(text, value);
  return li;
}

function emptyItem(message: string): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'empty';
  li.textContent = message;
  return li;
}

/** Counts from the active X tab's in-memory record. */
async function renderDiagnostics() {
  const list = $('diagList');
  let reply: { ok?: boolean; diagnostics?: DiagnosticsSnapshot; pause?: string | null } | undefined;
  try {
    const tab = await activeTab();
    if (!tab?.id || !isXUrl(tab.url)) {
      list.replaceChildren(emptyItem(t.diagNotX));
      $('diagSummary').textContent = '';
      return;
    }
    reply = await chrome.tabs.sendMessage(tab.id, { type: 'ANTI_SLOP_DIAGNOSTICS' });
  } catch {
    reply = undefined;
  }
  const d = reply?.ok ? reply.diagnostics : undefined;
  if (!d) {
    list.replaceChildren(emptyItem(t.diagUnavailable));
    $('diagSummary').textContent = '';
    return;
  }
  $('diagSummary').textContent = t.diagTotal(d.total);
  const items: HTMLLIElement[] = [];
  if (reply?.pause === 'rate_limited') items.push(emptyItem(t.diagPauseRate));
  if (reply?.pause === 'authentication') items.push(emptyItem(t.diagPauseAuth));
  if (!d.total) items.push(emptyItem(t.diagEmpty));
  const outcomes = Object.entries(d.outcomes).sort((a, b) => b[1] - a[1]);
  for (const [key, count] of outcomes) {
    const [status, code] = key.split(':');
    items.push(diagItem(outcomeLabel(status, code, ui), count));
  }
  if (d.total) {
    items.push(diagItem(t.diagWouldFold, d.counterfactualFolds));
    items.push(diagItem(t.diagMarked, d.presented.advisory + d.presented.fold));
  }
  if (d.modelCalls) {
    items.push(diagItem(t.diagCalls, d.modelCalls));
    if (d.meanLatencyMs !== null) items.push(diagItem(t.diagMeanLatency, d.meanLatencyMs));
  }
  const reported = Object.values(d.reports).reduce((sum, n) => sum + (n ?? 0), 0);
  if (reported) items.push(diagItem(t.diagReported, reported));
  list.replaceChildren(...items);
}

async function undoBlock(button: HTMLButtonElement) {
  const status = $('undoNote');
  button.disabled = true;
  status.classList.remove('warn');
  status.textContent = t.saving;
  try {
    const res = (await chrome.runtime.sendMessage({
      type: 'ANTI_SLOP_UNDO_BLOCK',
      ts: Number(button.dataset.ts),
      handle: button.dataset.handle || '',
    })) as { ok?: boolean; error?: string } | undefined;
    if (res?.ok) {
      status.textContent = t.undoOk;
      await renderLog();
    } else {
      status.classList.add('warn');
      status.textContent = res?.error === 'no-x-tab' ? t.undoNoTab : t.undoFail;
    }
  } catch {
    status.classList.add('warn');
    status.textContent = t.undoFail;
  } finally {
    button.disabled = false;
  }
}

async function renderLog() {
  const entries = await readActionLog();
  const list = $('logList');
  $('logSummary').textContent = entries.length ? t.logCount(entries.length) : t.logEmptySummary;
  ($('clearLog') as HTMLButtonElement).disabled = entries.length === 0;
  clearArmed = false;
  $('clearLog').textContent = t.logClear;
  if (!entries.length) {
    list.innerHTML = `<li class="empty">${t.logEmpty}</li>`;
    return;
  }
  const dates = new Intl.DateTimeFormat(language, {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  });
  list.innerHTML = entries.slice(0, 8).map((entry) => {
    const action = entry.action === 'block' ? t.block : t.mute;
    const canUndo = entry.action === 'block' && entry.ok;
    const tail = !canUndo ? '' : entry.undone
      ? `<span class="done">${t.undone}</span>`
      : `<button class="act" data-ts="${entry.ts}" data-handle="${escapeHtml(entry.handle)}" title="${t.undoHint}" aria-label="${t.undo} @${escapeHtml(entry.handle)}">${t.undo}</button>`;
    const detail = [action, `${Math.round(entry.score * 100)}%`, dates.format(entry.ts), !entry.ok ? t.failed : ''].filter(Boolean).join(' · ');
    return `<li class="${entry.ok ? '' : 'fail'}"><span class="log-entry"><span class="who" title="@${escapeHtml(entry.handle)}">@${escapeHtml(entry.handle)}</span><span class="entry-detail">${escapeHtml(detail)}</span></span>${tail}</li>`;
  }).join('');
  list.querySelectorAll<HTMLButtonElement>('button.act').forEach((button) => {
    button.addEventListener('click', () => void undoBlock(button));
  });
}

function applyLabels() {
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  const labels: Record<string, string> = {
    lblBehavior: t.behavior, lblMode: t.mode, modeManual: t.modeManual, modeShadow: t.modeShadow,
    lblScope: t.scope, scopeReplies: t.scopeReplies, scopeAll: t.scopeAll,
    lblDebug: t.debug, debugHint: t.debugHint, scanLabel: t.scan,
    lblSettings: t.settings, lblDiag: t.diagTitle, diagHint: t.diagHint,
    lblLog: t.logTitle, logHint: t.logHint, clearLog: t.logClear,
    saveStatus: t.autoSaved, statusTitle: t.loading,
  };
  for (const [id, label] of Object.entries(labels)) $(id).textContent = label;
  input('enabled').setAttribute('aria-label', t.enable);
  $('scan').closest('section')!.setAttribute('aria-label', t.scan);
  $('clearLog').title = t.logClearHint;
  $('version').textContent = `v${chrome.runtime.getManifest().version}`;
}

async function main() {
  applyLabels();
  const refreshPermission = () => { if (settings) render(settings); };
  chrome.permissions?.onAdded?.addListener(refreshPermission);
  chrome.permissions?.onRemoved?.addListener(refreshPermission);
  chrome.storage?.onChanged?.addListener((changes, area) => {
    if (area !== 'local' || !changes[settingsKey()]) return;
    const revision = ++storageReloadRevision;
    void loadSettings().then((current) => {
      if (revision !== storageReloadRevision) return;
      settings = current;
      settingsRevision++;
      render(current);
    }).catch(() => note(t.loadFailed, true));
  });
  $('settings').addEventListener('click', () => {
    void chrome.runtime.openOptionsPage().catch(() => note(t.settingsFailed, true));
  });
  input('enabled').addEventListener('change', () => void persist({ enabled: input('enabled').checked }));
  input('debugMode').addEventListener('change', () => void persist({ debugMode: input('debugMode').checked }));
  document.querySelectorAll<HTMLInputElement>('input[name="scanMode"]').forEach((radio) => {
    radio.addEventListener('change', () => {
      if (radio.checked) void persist({ scanMode: radio.value as Settings['scanMode'] });
    });
  });
  $('scanScope').addEventListener('change', () => {
    void persist({ scanScope: ($('scanScope') as HTMLSelectElement).value as Settings['scanScope'] });
  });
  $('scan').addEventListener('click', () => void scan());
  $('diag').addEventListener('toggle', () => {
    if (($('diag') as HTMLDetailsElement).open) void renderDiagnostics();
  });
  $('clearLog').addEventListener('click', () => {
    if (!clearArmed) {
      clearArmed = true;
      $('clearLog').textContent = t.logClearConfirm;
      return;
    }
    ($('clearLog') as HTMLButtonElement).disabled = true;
    void clearActionLog().then(() => renderLog()).catch(() => {
      $('undoNote').textContent = t.logClearFailed;
      $('undoNote').classList.add('warn');
      ($('clearLog') as HTMLButtonElement).disabled = false;
    });
  });
  $('log').addEventListener('toggle', () => {
    if (!($('log') as HTMLDetailsElement).open) {
      clearArmed = false;
      $('clearLog').textContent = t.logClear;
    }
  });

  try {
    settings = await loadSettings();
    render(settings);
  } catch {
    $('statusTitle').textContent = t.loadFailed;
    $('saveStatus').textContent = t.saveFailed;
    $('saveStatus').classList.add('warn');
    return;
  }
  // An unreadable URL is allowed: sendMessage will provide the actionable error.
  try {
    tabIsX = isXUrl((await activeTab())?.url);
    if (!scanning) {
      const hint = scanHint(settings);
      note(hint.text, hint.warn);
    }
    syncDisabled();
  } catch { /* Defer availability detection to the scan action. */ }
  try {
    await renderLog();
  } catch {
    $('logSummary').textContent = t.logFailed;
  }
}

void main();

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
}
