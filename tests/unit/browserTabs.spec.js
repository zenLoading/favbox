import { describe, expect, it, vi, beforeEach } from 'vitest';
import browser from 'webextension-polyfill';
import findActiveTabByUrl from '@/services/browserTabs';

vi.mock('webextension-polyfill', () => ({
  default: {
    tabs: {
      query: vi.fn(),
    },
  },
}));
const mockQuery = vi.mocked(browser.tabs.query);

describe('browserTabs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('findActiveTabByUrl', () => {
    it('queries the active tab of the last focused window only', async () => {
      mockQuery.mockResolvedValue([]);

      await findActiveTabByUrl('https://example.com');

      expect(mockQuery).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true });
    });

    it('returns the tab when its url matches the bookmark url', async () => {
      const tab = { id: 7, windowId: 1, url: 'https://example.com' };
      mockQuery.mockResolvedValue([tab]);

      const result = await findActiveTabByUrl('https://example.com');

      expect(result).toBe(tab);
    });

    it('returns null when the active tab shows a different page', async () => {
      mockQuery.mockResolvedValue([{ id: 7, windowId: 1, url: 'https://other.com' }]);

      const result = await findActiveTabByUrl('https://example.com');

      expect(result).toBeNull();
    });

    it('returns null when there is no active tab', async () => {
      mockQuery.mockResolvedValue([]);

      const result = await findActiveTabByUrl('https://example.com');

      expect(result).toBeNull();
    });

    it('returns null when the tabs query fails', async () => {
      mockQuery.mockRejectedValue(new Error('No window'));

      const result = await findActiveTabByUrl('https://example.com');

      expect(result).toBeNull();
    });
  });
});
