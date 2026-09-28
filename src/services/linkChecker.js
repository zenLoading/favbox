import { HTTP_STATUS } from '@/constants/httpStatus';
import { fetchHead, fetchUrl } from '@/services/httpClient';
import runWithHostLimit, { hostOfUrl } from '@/services/hostPool';

const DEFAULTS = {
  concurrency: 50,
  // Chrome opens at most 6 connections per host; queued requests would time out and look broken
  perHost: 6,
  timeout: 15000,
};

/**
 * Checks the http status of bookmarks and returns the broken ones.
 * Some servers answer 404 to HEAD only, so 404 is double-checked with a GET
 * that does not download the body.
 * @param {Array<{id: string, url: string}>} bookmarks
 * @param {object} [options]
 * @param {number} [options.concurrency] - Max requests in flight overall.
 * @param {number} [options.perHost] - Max requests in flight per host.
 * @param {number} [options.timeout] - Timeout per request in milliseconds.
 * @returns {Promise<Array<{id: string, httpStatus: number}>>}
 */
export default async function findBrokenLinks(bookmarks, options = {}) {
  const { concurrency, perHost, timeout } = { ...DEFAULTS, ...options };
  const broken = [];

  const check = async (bookmark) => {
    let httpStatus = await fetchHead(bookmark.url, timeout);
    if (httpStatus === HTTP_STATUS.NOT_FOUND) {
      httpStatus = (await fetchUrl(bookmark.url, timeout, { maxBytes: 0 })).httpStatus;
    }
    if (httpStatus >= HTTP_STATUS.BAD_REQUEST) {
      broken.push({ id: bookmark.id, httpStatus });
    }
  };

  await runWithHostLimit(bookmarks, check, {
    concurrency,
    perHost,
    hostOf: ({ url }) => hostOfUrl(url),
  });
  return broken;
}
