import { describe, expect, it } from 'vitest';

import { describeBackendAvailability } from './env-backends';

describe('设置页的第一行', () => {
  it('this build has a backend, and says so', () => {
    expect(describeBackendAvailability(2)).toContain('构建时预置的后端');
  });

  it('this build has none, and does not promise one', () => {
    // The public build that goes to the store has no preset backend. The
    // line used to promise one anyway — on the screen where the user goes
    // to look for their API key.
    const line = describeBackendAvailability(0);
    expect(line).not.toContain('构建时预置的后端');
    expect(line).toContain('API Key');
    expect(line).toContain('Ollama');
  });
});
