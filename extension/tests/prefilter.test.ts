import { describe, expect, it } from 'vitest';
import { runPrefilter } from '../lib/prefilter';

describe('prefilter', () => {
  it('flags stock AI praise', () => {
    const r = runPrefilter({
      id: '1',
      handle: 'user12345678',
      text: 'Great point! This is a game-changer 🚀🔥',
      isReply: true,
    });
    expect(r.score).toBeGreaterThan(0.4);
    expect(r.hits.some((h) => h.id === 'great_point' || h.id === 'game_changer')).toBe(true);
    expect(r.hits.some((h) => h.id === 'handle_digits')).toBe(true);
  });

  it('flags contrast pivot', () => {
    const r = runPrefilter({
      id: '2',
      handle: 'alice',
      text: "It's not about the tools, it's about the mindset.",
      isReply: true,
    });
    expect(r.hits.some((h) => h.id === 'contrast_pivot')).toBe(true);
  });

  it('flags DM / airdrop bait as decisive', () => {
    const r = runPrefilter({
      id: '3',
      handle: 'promo',
      text: 'DM me for the airdrop whitelist link in bio',
      isReply: true,
    });
    expect(r.decisive).toBe(true);
    expect(r.score).toBeGreaterThan(0.5);
  });

  it('softens score for human-like laughs', () => {
    const bot = runPrefilter({
      id: '4',
      handle: 'x',
      text: 'Great point! This resonates deeply.',
      isReply: true,
    });
    const human = runPrefilter({
      id: '5',
      handle: 'x',
      text: 'Great point! This resonates deeply lmaooo',
      isReply: true,
    });
    expect(human.score).toBeLessThan(bot.score);
  });

  it('detects ultra-fast long reply', () => {
    const parent = Date.now();
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
    const r = runPrefilter({
      id: '6',
      handle: 'speed',
      text,
      isReply: true,
      createdAtMs: parent + 15_000,
      parentCreatedAtMs: parent,
    });
    expect(r.hits.some((h) => h.id === 'ultra_fast_long')).toBe(true);
  });
});
