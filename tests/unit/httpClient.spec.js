import { describe, expect, it, vi, afterEach } from 'vitest';
import { fetchUrl } from '@/services/httpClient';
import { HTTP_STATUS } from '@/constants/httpStatus';

const encoder = new TextEncoder();

/**
 * Builds a pull-based body stream that records how many chunks were read.
 * @param {Array<string|Uint8Array>} chunks
 */
const createBody = (chunks) => {
  const state = { pulls: 0, cancel: vi.fn() };
  state.stream = new ReadableStream({
    pull(controller) {
      if (state.pulls < chunks.length) {
        const chunk = chunks[state.pulls];
        controller.enqueue(typeof chunk === 'string' ? encoder.encode(chunk) : chunk);
        state.pulls += 1;
      } else {
        controller.close();
      }
    },
    cancel: state.cancel,
  }, { highWaterMark: 0 });
  return state;
};

const mockFetchResponse = (body, { status = 200, contentType = 'text/html; charset=utf-8' } = {}) => {
  const headers = contentType ? { 'content-type': contentType } : {};
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body.stream, { status, headers })));
};

describe('httpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('fetchUrl', () => {
    it('returns the whole body when no options are given', async () => {
      const body = createBody(['<html>', '<head></head>', '<body></body></html>']);
      mockFetchResponse(body);

      const result = await fetchUrl('https://example.com');

      expect(result).toEqual({ html: '<html><head></head><body></body></html>', httpStatus: 200 });
    });

    it('does not download the body of unsuccessful responses', async () => {
      const body = createBody(['<html>not found</html>']);
      mockFetchResponse(body, { status: 404 });

      const result = await fetchUrl('https://example.com');

      expect(result).toEqual({ html: null, httpStatus: 404 });
      expect(body.pulls).toBe(0);
      expect(body.cancel).toHaveBeenCalled();
    });

    it('skips non-html responses when htmlOnly is set', async () => {
      const body = createBody(['%PDF-1.7']);
      mockFetchResponse(body, { contentType: 'application/pdf' });

      const result = await fetchUrl('https://example.com/file.pdf', 1000, { htmlOnly: true });

      expect(result).toEqual({ html: null, httpStatus: 200 });
      expect(body.pulls).toBe(0);
      expect(body.cancel).toHaveBeenCalled();
    });

    it('treats a missing content-type as html when htmlOnly is set', async () => {
      const body = createBody(['<html></html>']);
      mockFetchResponse(body, { contentType: null });

      const result = await fetchUrl('https://example.com', 1000, { htmlOnly: true });

      expect(result).toEqual({ html: '<html></html>', httpStatus: 200 });
    });

    it('accepts xhtml when htmlOnly is set', async () => {
      const body = createBody(['<html></html>']);
      mockFetchResponse(body, { contentType: 'application/xhtml+xml' });

      const result = await fetchUrl('https://example.com', 1000, { htmlOnly: true });

      expect(result.html).toBe('<html></html>');
    });

    it('stops reading as soon as isComplete returns true', async () => {
      const body = createBody(['<html><head>', '<title>x</title></head>', '<body>', 'rest</body></html>']);
      mockFetchResponse(body);

      const result = await fetchUrl('https://example.com', 1000, {
        isComplete: (html) => html.includes('</head>'),
      });

      expect(result.html).toBe('<html><head><title>x</title></head>');
      expect(body.pulls).toBe(2);
      expect(body.cancel).toHaveBeenCalled();
    });

    it('stops reading once maxBytes is reached', async () => {
      const body = createBody(['0123456789', '0123456789', '0123456789', '0123456789']);
      mockFetchResponse(body);

      const result = await fetchUrl('https://example.com', 1000, { maxBytes: 15 });

      expect(result.html).toBe('01234567890123456789');
      expect(body.pulls).toBe(2);
      expect(body.cancel).toHaveBeenCalled();
    });

    it('decodes multi-byte characters split across chunks', async () => {
      const bytes = encoder.encode('<title>书签</title>');
      const body = createBody([bytes.slice(0, 9), bytes.slice(9)]);
      mockFetchResponse(body);

      const result = await fetchUrl('https://example.com', 1000, { maxBytes: 1024 });

      expect(result.html).toBe('<title>书签</title>');
    });

    it('returns REQUEST_TIMEOUT when the request is aborted by timeout', async () => {
      vi.stubGlobal('fetch', vi.fn((url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      })));

      const result = await fetchUrl('https://example.com', 5);

      expect(result).toEqual({ html: null, httpStatus: HTTP_STATUS.REQUEST_TIMEOUT });
    });

    it('returns UNKNOWN_ERROR on network failure', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));

      const result = await fetchUrl('https://example.com', 1000, { htmlOnly: true });

      expect(result).toEqual({ html: null, httpStatus: HTTP_STATUS.UNKNOWN_ERROR });
    });
  });
});
