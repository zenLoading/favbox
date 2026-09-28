import { HTTP_STATUS } from '@/constants/httpStatus';

const HTML_CONTENT_TYPE = /text\/html|application\/xhtml\+xml/i;

/**
 * Releases the connection without downloading the rest of the body.
 * @param {ReadableStream|ReadableStreamDefaultReader|null} source
 */
const discard = (source) => {
  // cancel() only fails when the stream is already errored, which is fine to ignore here
  source?.cancel().catch(() => {});
};

const isHtml = (response) => {
  const contentType = response.headers.get('content-type');
  return !contentType || HTML_CONTENT_TYPE.test(contentType);
};

/**
 * Reads the body as text, stopping early once enough has been read.
 * @param {Response} response
 * @param {number} maxBytes - Soft limit: reading stops after the chunk that crosses it.
 * @param {((html: string) => boolean)|null} isComplete - Stops reading when it returns true.
 * @returns {Promise<string>}
 */
const readText = async (response, maxBytes, isComplete) => {
  if (!response.body) return '';
  if (maxBytes === Infinity && !isComplete) return response.text();

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (bytes < maxBytes) {
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) return text + decoder.decode();
      bytes += value.byteLength;
      text += decoder.decode(value, { stream: true });
      if (isComplete?.(text)) break;
    }
    return text;
  } finally {
    discard(reader);
  }
};

/**
 * Makes an HTTP GET request with a timeout.
 * The body of unsuccessful responses is never downloaded.
 * @param {string} url - The URL to fetch.
 * @param {number} [timeout] - Timeout in milliseconds (default: 20000).
 * @param {object} [options]
 * @param {boolean} [options.htmlOnly] - Skip the body unless the response is HTML.
 * @param {number} [options.maxBytes] - Stop reading after about this many bytes.
 * @param {(html: string) => boolean} [options.isComplete] - Stop reading once it returns true.
 * @returns {Promise<{html: string|null, httpStatus: number}>}
 */
export async function fetchUrl(url, timeout = 20000, { htmlOnly = false, maxBytes = Infinity, isComplete = null } = {}) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok || (htmlOnly && !isHtml(response))) {
      discard(response.body);
      return { html: null, httpStatus: response.status };
    }
    return {
      html: await readText(response, maxBytes, isComplete),
      httpStatus: response.status,
    };
  } catch (e) {
    const errorCode = e.name === 'AbortError' ? HTTP_STATUS.REQUEST_TIMEOUT : HTTP_STATUS.UNKNOWN_ERROR;
    return {
      httpStatus: errorCode,
      html: null,
    };
  } finally {
    clearTimeout(id);
  }
}

/**
 * Makes a HEAD HTTP request with a timeout.
 * @param {string} url - The URL to make HEAD request to.
 * @param {number} [timeout] - Timeout in milliseconds (default: 20000).
 * @returns {Promise<number>} The HTTP status code or error code (REQUEST_TIMEOUT, UNKNOWN_ERROR).
 */
export async function fetchHead(url, timeout = 20000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method: 'HEAD',
      mode: 'cors',
      redirect: 'follow',
      signal: controller.signal,
    });
    return response.status;
  } catch (e) {
    const errorCode = e.name === 'AbortError' ? HTTP_STATUS.REQUEST_TIMEOUT : HTTP_STATUS.UNKNOWN_ERROR;
    return errorCode;
  } finally {
    clearTimeout(id);
  }
}
