import { describe, expect, it } from 'vitest';
import { createDiagnostics } from '../lib/diagnostics';

describe('model request diagnostics', () => {
  it('counts shared requests once and reports mean latency', () => {
    const diagnostics = createDiagnostics();
    diagnostics.recordTransport({ id: 'request-one', latencyMs: 10 });
    diagnostics.recordTransport({ id: 'request-one', latencyMs: 10 });
    diagnostics.recordTransport({ id: 'request-two', latencyMs: 30 });
    expect(diagnostics.snapshot()).toMatchObject({ modelCalls: 2, meanLatencyMs: 20 });
  });

  it('does not count invalid timing records', () => {
    const diagnostics = createDiagnostics();
    diagnostics.recordTransport({ id: 'bad-one', latencyMs: Infinity });
    diagnostics.recordTransport({ id: 'bad-two', latencyMs: -1 });
    expect(diagnostics.snapshot()).toMatchObject({ modelCalls: 0, meanLatencyMs: null });
  });
});
