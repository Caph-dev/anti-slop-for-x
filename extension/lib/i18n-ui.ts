/** Runtime UI strings (content script). Falls back to en. */

const EN: Record<string, string> = {
  foldedLabel: 'Possible AI/bot',
  expand: 'Show',
  pillHint: 'Click to fold this reply again',
  mute: 'Mute',
  block: 'Block',
  muteHint: 'Mute: you stop seeing this account’s posts; it is not told.',
  blockHint: 'Block: this account cannot follow or interact with you, and you stop seeing it.',
  muteOk: 'Muted',
  blockOk: 'Blocked',
  actionFail: 'Action failed',
};

const ZH: Record<string, string> = {
  foldedLabel: '疑似 AI/机器人',
  expand: '展开',
  pillHint: '点击重新折叠这条回复',
  mute: '静音',
  block: '屏蔽',
  muteHint: '静音：只是你不再看到这个账号的内容，对方不会收到通知。',
  blockHint: '屏蔽：对方无法关注你或与你互动，你也看不到对方。',
  muteOk: '已静音',
  blockOk: '已屏蔽',
  actionFail: '操作失败',
};

export function uiT(lang?: string): (key: string) => string {
  const useZh = (lang || navigator.language || 'en').toLowerCase().startsWith('zh');
  const table = useZh ? ZH : EN;
  return (key: string) => table[key] || EN[key] || key;
}
