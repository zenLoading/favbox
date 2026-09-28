import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchHead, fetchUrl } from '@/services/httpClient';
import findBrokenLinks from '@/services/linkChecker';

vi.mock('@/services/httpClient', () => ({
  fetchHead: vi.fn(),
  fetchUrl: vi.fn(),
}));

const bookmark = (id, url) => ({ id, url });

describe('findBrokenLinks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only bookmarks that answer with an error status', async () => {
    const statuses = { 'https://ok.com/': 200, 'https://gone.com/': 410, 'https://down.com/': 503 };
    vi.mocked(fetchHead).mockImplementation(async (url) => statuses[url]);

    const broken = await findBrokenLinks([
      bookmark('1', 'https://ok.com/'),
      bookmark('2', 'https://gone.com/'),
      bookmark('3', 'https://down.com/'),
    ]);

    expect(broken).toEqual(expect.arrayContaining([
      { id: '2', httpStatus: 410 },
      { id: '3', httpStatus: 503 },
    ]));
    expect(broken).toHaveLength(2);
  });

  it('double-checks 404 from HEAD with a GET that skips the body', async () => {
    vi.mocked(fetchHead).mockResolvedValue(404);
    vi.mocked(fetchUrl).mockResolvedValue({ html: '', httpStatus: 200 });

    const broken = await findBrokenLinks([bookmark('1', 'https://no-head.com/')], { timeout: 1000 });

    expect(broken).toEqual([]);
    expect(fetchUrl).toHaveBeenCalledWith('https://no-head.com/', 1000, { maxBytes: 0 });
  });

  it('reports the GET status when the page really is missing', async () => {
    vi.mocked(fetchHead).mockResolvedValue(404);
    vi.mocked(fetchUrl).mockResolvedValue({ html: null, httpStatus: 404 });

    const broken = await findBrokenLinks([bookmark('1', 'https://missing.com/')]);

    expect(broken).toEqual([{ id: '1', httpStatus: 404 }]);
  });

  it('limits concurrent requests to the same host', async () => {
    let active = 0;
    let peak = 0;
    vi.mocked(fetchHead).mockImplementation(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => { setTimeout(resolve, 0); });
      active -= 1;
      return 200;
    });
    const bookmarks = Array.from({ length: 30 }, (_, i) => bookmark(String(i), `https://github.com/${i}`));

    await findBrokenLinks(bookmarks, { perHost: 4 });

    expect(fetchHead).toHaveBeenCalledTimes(30);
    expect(peak).toBe(4);
  });

  it('returns an empty list for no bookmarks', async () => {
    expect(await findBrokenLinks([])).toEqual([]);
    expect(fetchHead).not.toHaveBeenCalled();
  });
});
