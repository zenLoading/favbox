import { describe, expect, it, vi } from 'vitest';
import runWithHostLimit from '@/services/hostPool';

const hostOf = (item) => item.host;

/**
 * Worker that resolves on the next macrotask and records peak concurrency.
 */
const createTrackingWorker = () => {
  const stats = { active: 0, peak: 0, perHost: new Map(), peakPerHost: new Map(), order: [] };
  const worker = async (item) => {
    stats.order.push(item.id);
    stats.active += 1;
    stats.peak = Math.max(stats.peak, stats.active);
    const hostActive = (stats.perHost.get(item.host) || 0) + 1;
    stats.perHost.set(item.host, hostActive);
    stats.peakPerHost.set(item.host, Math.max(stats.peakPerHost.get(item.host) || 0, hostActive));
    await new Promise((resolve) => { setTimeout(resolve, 0); });
    stats.active -= 1;
    stats.perHost.set(item.host, stats.perHost.get(item.host) - 1);
  };
  return { worker, stats };
};

const makeItems = (host, count, offset = 0) => Array.from(
  { length: count },
  (_, i) => ({ id: `${host}-${i + offset}`, host }),
);

describe('runWithHostLimit', () => {
  it('processes every item exactly once', async () => {
    const items = [...makeItems('a.com', 10), ...makeItems('b.com', 7), ...makeItems('c.com', 1)];
    const { worker, stats } = createTrackingWorker();

    await runWithHostLimit(items, worker, { concurrency: 5, perHost: 2, hostOf });

    expect(stats.order).toHaveLength(items.length);
    expect(new Set(stats.order)).toEqual(new Set(items.map((i) => i.id)));
  });

  it('never exceeds the global concurrency limit', async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: String(i), host: `h${i}.com` }));
    const { worker, stats } = createTrackingWorker();

    await runWithHostLimit(items, worker, { concurrency: 4, perHost: 2, hostOf });

    expect(stats.peak).toBe(4);
  });

  it('never exceeds the per-host limit even when one host dominates', async () => {
    const items = [...makeItems('big.com', 50), ...makeItems('small.com', 3)];
    const { worker, stats } = createTrackingWorker();

    await runWithHostLimit(items, worker, { concurrency: 20, perHost: 3, hostOf });

    expect(stats.peakPerHost.get('big.com')).toBe(3);
    expect(stats.peakPerHost.get('small.com')).toBeLessThanOrEqual(3);
  });

  it('interleaves hosts round-robin while keeping per-host order', async () => {
    const items = [...makeItems('a.com', 3), ...makeItems('b.com', 3)];
    const { worker, stats } = createTrackingWorker();

    await runWithHostLimit(items, worker, { concurrency: 1, perHost: 1, hostOf });

    expect(stats.order).toEqual(['a.com-0', 'b.com-0', 'a.com-1', 'b.com-1', 'a.com-2', 'b.com-2']);
  });

  it('keeps going when a worker fails', async () => {
    const items = makeItems('a.com', 5);
    const processed = [];
    const worker = vi.fn(async (item) => {
      if (item.id === 'a.com-1') throw new Error('boom');
      processed.push(item.id);
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runWithHostLimit(items, worker, { concurrency: 2, perHost: 2, hostOf });

    expect(processed).toEqual(['a.com-0', 'a.com-2', 'a.com-3', 'a.com-4']);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it('resolves immediately for an empty list', async () => {
    const worker = vi.fn();

    await runWithHostLimit([], worker, { concurrency: 2, perHost: 1, hostOf });

    expect(worker).not.toHaveBeenCalled();
  });

  it('rejects invalid limits', () => {
    expect(() => runWithHostLimit([], vi.fn(), { concurrency: 0, perHost: 1, hostOf })).toThrow();
    expect(() => runWithHostLimit([], vi.fn(), { concurrency: 1, perHost: 0, hostOf })).toThrow();
  });
});
