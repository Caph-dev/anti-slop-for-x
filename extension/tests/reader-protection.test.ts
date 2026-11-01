import { describe, expect, it } from 'vitest';
import { createReaderProtection } from '../lib/reader-protection';

describe('reader protection', () => {
  it('protects a visible post immediately and remembers a sustained visit', () => {
    const reading = createReaderProtection(600);
    reading.enter('synthetic-post', 1000);
    expect(reading.protects('synthetic-post', 1000)).toBe(true);
    expect(reading.protects('synthetic-post', 1100)).toBe(true);
    reading.leave('synthetic-post', 1700);
    expect(reading.protects('synthetic-post', 1800)).toBe(true);
  });

  it('does not mark a brief visit as permanently read', () => {
    const reading = createReaderProtection(600);
    reading.enter('synthetic-post', 1000);
    reading.leave('synthetic-post', 1100);
    expect(reading.protects('synthetic-post', 1200)).toBe(false);
  });
});
