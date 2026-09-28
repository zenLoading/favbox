/**
 * Groups items by host, keeping their original order within each host.
 * @param {Array} items
 * @param {(item: any) => string} hostOf
 * @returns {Map<string, {items: Array, next: number, active: number}>}
 */
const groupByHost = (items, hostOf) => items.reduce((queues, item) => {
  const host = hostOf(item);
  const queue = queues.get(host) ?? { items: [], next: 0, active: 0 };
  queue.items.push(item);
  return queues.set(host, queue);
}, new Map());

/**
 * Runs `worker` for every item with a global concurrency limit and a per-host limit.
 * Hosts are served round-robin, so a host with many items neither starves the others
 * nor takes more than `perHost` connections. Browsers queue extra requests to the
 * same host, and a queued request can hit its timeout before it is even sent.
 * Worker errors are logged and do not stop the remaining items.
 * @param {Array} items
 * @param {(item: any) => Promise<void>} worker
 * @param {object} limits
 * @param {number} limits.concurrency - Max items in flight overall.
 * @param {number} limits.perHost - Max items in flight per host.
 * @param {(item: any) => string} limits.hostOf - Returns the host of an item.
 * @returns {Promise<void>} Resolves when every item has been processed.
 */
export default function runWithHostLimit(items, worker, { concurrency, perHost, hostOf }) {
  if (!(concurrency >= 1) || !(perHost >= 1)) {
    throw new RangeError(`Invalid limits: concurrency=${concurrency}, perHost=${perHost}`);
  }
  const queues = groupByHost(items, hostOf);
  const hosts = [...queues.keys()];
  let cursor = 0;
  let active = 0;

  // Next item of the first host (round-robin) that is below its limit
  const take = () => {
    for (let i = 0; i < hosts.length; i++) {
      const index = (cursor + i) % hosts.length;
      const queue = queues.get(hosts[index]);
      if (queue.active < perHost) {
        const item = queue.items[queue.next];
        queue.next += 1;
        if (queue.next === queue.items.length) {
          hosts.splice(index, 1);
          cursor = index;
        } else {
          cursor = index + 1;
        }
        return { queue, item };
      }
    }
    return null;
  };

  const run = ({ queue, item }, onDone) => {
    active += 1;
    queue.active += 1;
    Promise.resolve()
      .then(() => worker(item))
      .catch((e) => console.error('Worker failed', e))
      .finally(() => {
        active -= 1;
        queue.active -= 1;
        onDone();
      });
  };

  return new Promise((resolve) => {
    const pump = () => {
      while (active < concurrency) {
        const next = take();
        if (!next) break;
        run(next, pump);
      }
      if (active === 0) resolve();
    };
    pump();
  });
}
