import {
  getBookmarksFromNode,
  getFolderTree,
  getFoldersMap,
  getBookmarksSnapshot,
} from '@/services/browserBookmarks';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import browser from 'webextension-polyfill';

vi.mock('webextension-polyfill', () => ({
  default: {
    bookmarks: {
      getTree: vi.fn(),
    },
  },
}));
const mockGetTree = vi.mocked(browser.bookmarks.getTree);

describe('browserBookmarks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTree.mockClear();
  });

  describe('getBookmarksFromNode', () => {
    it('should extract bookmarks from node', () => {
      const node = {
        id: '1',
        title: 'Folder',
        children: [
          { id: '2', title: 'Bookmark 1', url: 'https://example.com' },
          { id: '3', title: 'Bookmark 2', url: 'https://google.com' },
        ],
      };
      const bookmarks = getBookmarksFromNode(node);
      expect(bookmarks).toHaveLength(2);
      expect(bookmarks[0]).toEqual({ id: '2', url: 'https://example.com' });
      expect(bookmarks[1]).toEqual({ id: '3', url: 'https://google.com' });
    });

    it('should handle node with url (bookmark itself)', () => {
      const node = {
        id: '1',
        title: 'Bookmark',
        url: 'https://example.com',
      };
      const bookmarks = getBookmarksFromNode(node);
      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0]).toEqual({ id: '1', url: 'https://example.com' });
    });

    it('should return empty array for null node', () => {
      expect(getBookmarksFromNode(null)).toEqual([]);
    });

    it('should return empty array for undefined node', () => {
      expect(getBookmarksFromNode(undefined)).toEqual([]);
    });

    it('should handle nested folders', () => {
      const node = {
        id: '1',
        title: 'Folder',
        children: [
          {
            id: '2',
            title: 'Subfolder',
            children: [
              { id: '3', title: 'Bookmark 1', url: 'https://example.com' },
            ],
          },
          { id: '4', title: 'Bookmark 2', url: 'https://google.com' },
        ],
      };
      const bookmarks = getBookmarksFromNode(node);
      expect(bookmarks).toHaveLength(2);
    });

    it('should ignore folders without url', () => {
      const node = {
        id: '1',
        title: 'Folder',
        children: [
          { id: '2', title: 'Subfolder', children: [] },
          { id: '3', title: 'Bookmark', url: 'https://example.com' },
        ],
      };
      const bookmarks = getBookmarksFromNode(node);
      expect(bookmarks).toHaveLength(1);
      expect(bookmarks[0].id).toBe('3');
    });
  });

  describe('getFolderTree', () => {
    it('should build folder tree with counts', async () => {
      const mockTree = [
        {
          id: '0',
          children: [
            {
              id: '1',
              title: 'Folder 1',
              children: [
                { id: '2', title: 'Bookmark 1', url: 'https://example.com' },
                { id: '3', title: 'Bookmark 2', url: 'https://google.com' },
              ],
            },
            {
              id: '4',
              title: 'Folder 2',
              children: [
                { id: '5', title: 'Bookmark 3', url: 'https://github.com' },
              ],
            },
          ],
        },
      ];
      mockGetTree.mockResolvedValue(mockTree);

      const tree = await getFolderTree();
      expect(tree).toHaveLength(2);
      expect(tree[0]).toMatchObject({
        id: '1',
        label: 'Folder 1',
        count: 2,
      });
      expect(tree[1]).toMatchObject({
        id: '4',
        label: 'Folder 2',
        count: 1,
      });
    });

    it('should handle nested folders with correct counts', async () => {
      const mockTree = [
        {
          id: '0',
          children: [
            {
              id: '1',
              title: 'Folder 1',
              children: [
                { id: '2', title: 'Bookmark 1', url: 'https://example.com' },
                {
                  id: '3',
                  title: 'Subfolder',
                  children: [
                    { id: '4', title: 'Bookmark 2', url: 'https://google.com' },
                    { id: '5', title: 'Bookmark 3', url: 'https://github.com' },
                  ],
                },
              ],
            },
          ],
        },
      ];
      mockGetTree.mockResolvedValue(mockTree);

      const tree = await getFolderTree();
      expect(tree).toHaveLength(1);
      expect(tree[0].count).toBe(3); // 1 direct + 2 from subfolder
      expect(tree[0].children).toHaveLength(1);
      expect(tree[0].children[0].count).toBe(2);
    });

    it('should filter out bookmarks (only folders)', async () => {
      const mockTree = [
        {
          id: '0',
          children: [
            { id: '1', title: 'Bookmark 1', url: 'https://example.com' },
            {
              id: '2',
              title: 'Folder',
              children: [
                { id: '3', title: 'Bookmark 2', url: 'https://google.com' },
              ],
            },
          ],
        },
      ];
      mockGetTree.mockResolvedValue(mockTree);

      const tree = await getFolderTree();
      expect(tree).toHaveLength(1);
      expect(tree[0].id).toBe('2');
    });

    it('should not include children property when folder has no subfolders', async () => {
      const mockTree = [
        {
          id: '0',
          children: [
            {
              id: '1',
              title: 'Folder 1',
              children: [
                { id: '2', title: 'Bookmark 1', url: 'https://example.com' },
              ],
            },
          ],
        },
      ];
      mockGetTree.mockResolvedValue(mockTree);

      const tree = await getFolderTree();
      expect(tree[0].children).toBeUndefined();
    });
  });

  describe('getFoldersMap', () => {
    it('should create map of folder ids to titles', async () => {
      const mockTree = [
        {
          id: '0',
          children: [
            {
              id: '1',
              title: 'Folder 1',
              children: [
                { id: '2', title: 'Bookmark', url: 'https://example.com' },
              ],
            },
            {
              id: '3',
              title: 'Folder 2',
              children: [],
            },
          ],
        },
      ];
      mockGetTree.mockResolvedValue(mockTree);

      const map = await getFoldersMap();
      expect(map).toBeInstanceOf(Map);
      expect(map.get('1')).toBe('Folder 1');
      expect(map.get('3')).toBe('Folder 2');
    });

    it('should handle nested folders', async () => {
      const mockTree = [
        {
          id: '0',
          children: [
            {
              id: '1',
              title: 'Folder 1',
              children: [
                {
                  id: '2',
                  title: 'Subfolder',
                  children: [],
                },
              ],
            },
          ],
        },
      ];
      mockGetTree.mockResolvedValue(mockTree);

      const map = await getFoldersMap();
      expect(map.get('1')).toBe('Folder 1');
      expect(map.get('2')).toBe('Subfolder');
    });
  });

  describe('getBookmarksSnapshot', () => {
    const mockTree = [
      {
        id: '0',
        title: '',
        children: [
          {
            id: '1',
            title: 'Folder',
            children: [
              { id: '2', title: 'Bookmark 1', url: 'https://example.com', parentId: '1' },
              {
                id: '3',
                title: 'Subfolder',
                children: [
                  { id: '4', title: 'Bookmark 2', url: 'https://github.com', parentId: '3' },
                ],
              },
            ],
          },
          { id: '5', title: 'Bookmark 3', url: 'https://google.com', parentId: '0' },
        ],
      },
    ];

    it('reads the bookmark tree only once', async () => {
      mockGetTree.mockResolvedValue(mockTree);

      await getBookmarksSnapshot();

      expect(mockGetTree).toHaveBeenCalledTimes(1);
    });

    it('returns every bookmark in tree order', async () => {
      mockGetTree.mockResolvedValue(mockTree);

      const { bookmarks } = await getBookmarksSnapshot();

      expect(bookmarks.map((b) => b.id)).toEqual(['2', '4', '5']);
      expect(bookmarks[1]).toMatchObject({ url: 'https://github.com', parentId: '3' });
    });

    it('returns a map of folder ids to titles', async () => {
      mockGetTree.mockResolvedValue(mockTree);

      const { folders } = await getBookmarksSnapshot();

      expect(folders).toEqual(new Map([['0', ''], ['1', 'Folder'], ['3', 'Subfolder']]));
    });

    it('handles an empty tree', async () => {
      mockGetTree.mockResolvedValue([{ id: '0', children: [] }]);

      const { bookmarks, folders } = await getBookmarksSnapshot();

      expect(bookmarks).toEqual([]);
      expect(folders).toEqual(new Map([['0', undefined]]));
    });
  });
});
