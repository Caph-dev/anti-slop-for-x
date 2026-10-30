/** Runtime UI strings (content script). Falls back to en. */

const EN: Record<string, string> = {
  foldedLabel: 'Possible AI/bot',
  expand: 'Show',
  mute: 'Mute',
  block: 'Block',
  muteOk: 'Muted',
  blockOk: 'Blocked',
  actionFail: 'Action failed',
};

const ZH: Record<string, string> = {
  foldedLabel: '疑似 AI/机器人',
  expand: '展开',
  mute: '静音',
  block: '屏蔽',
  muteOk: '已静音',
  blockOk: '已屏蔽',
  actionFail: '操作失败',
};

export function uiT(lang?: string): (key: string) => string {
  const useZh = (lang || navigator.language || 'en').toLowerCase().startsWith('zh');
  const table = useZh ? ZH : EN;
  return (key: string) => table[key] || EN[key] || key;
}
