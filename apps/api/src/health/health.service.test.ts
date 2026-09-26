import { describe, expect, it } from 'vitest';
import { describeError, probe } from './health.service';

describe('probe', () => {
  it('marca como up quando a função resolve', async () => {
    const result = await probe(async () => 'PONG');
    expect(result.status).toBe('up');
    expect(result.error).toBeUndefined();
  });

  it('marca como down e guarda a mensagem quando a função falha', async () => {
    const result = await probe(async () => {
      throw new Error('connect ECONNREFUSED');
    });
    expect(result).toMatchObject({ status: 'down', error: 'connect ECONNREFUSED' });
  });

  it('marca como down quando passa do tempo limite', async () => {
    const result = await probe(() => new Promise(() => {}), 50);
    expect(result).toMatchObject({ status: 'down', error: 'timeout de 50 ms' });
    expect(result.latency_ms).toBeGreaterThanOrEqual(45);
  });
});

describe('describeError', () => {
  it('usa o código do primeiro erro de um AggregateError', () => {
    const refused = Object.assign(new Error(''), { code: 'ECONNREFUSED' });
    expect(describeError(new AggregateError([refused], ''))).toBe('ECONNREFUSED');
  });

  it('prefere a mensagem quando ela existe', () => {
    expect(describeError(new Error('password authentication failed'))).toBe('password authentication failed');
  });
});