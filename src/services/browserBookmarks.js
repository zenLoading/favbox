/**
 * Recursively collects all bookmarks from the given node.
 * @param {object} node - The bookmark node.
 * @returns {Array<{id: string, url: string}>}
 */
export function getBookmarksFromNode(node) {
  if (!node) {
    return [];
  }
  const items = [];
  if (node.url) {
    items.push({ id: node.id, url: node.url });
  }
  if (node.children) {
    for (const child of node.children) {
      items.push(...getBookmarksFromNode(child));
    }
  }
  return items;
}

/**
 * Retrieves the tree of all folders with bookmark counts.
 * @returns {Promise<Array<{id: string, label: string, count: number, children?: Array}>>}
 */
export async function getFolderTree() {
  const tree = await browser.bookmarks.getTree();
  const buildFolders = (nodes) => nodes
    .filter((node) => node.children && !node.url)
    .map((node) => {
      const children = buildFolders(node.children);
      const ownCount = node.children.filter((n) => n.url).length;
      const childrenCount = children.reduce((sum, c) => sum + c.count, 0);
      return {
        id: node.id,
        label: node.title,
        count: ownCount + childrenCount,
        ...(children.length > 0 && { children }),
      };
    });
  return buildFolders(tree[0].children);
}

/**
 * Reads the bookmark tree once and returns all bookmarks and folders.
 * @returns {Promise<{bookmarks: Array<browser.bookmarks.BookmarkTreeNode>, folders: Map<string, string>}>}
 */
export async function getBookmarksSnapshot() {
  const bookmarks = [];
  const folders = new Map();
  const traverse = (nodes) => {
    for (const node of nodes) {
      if (node.url) {
        bookmarks.push(node);
      }
      if (node.children) {
        folders.set(node.id, node.title);
        traverse(node.children);
      }
    }
  };
  traverse(await browser.bookmarks.getTree());
  return { bookmarks, folders };
}

/**
 * @returns {Promise<Map<string, string>>}
 */
export async function getFoldersMap() {
  const foldersMap = new Map();
  const traverseTree = (nodes) => {
    for (const node of nodes) {
      if (node.children) {
        foldersMap.set(node.id, node.title);
        traverseTree(node.children);
      }
    }
  };
  const tree = await browser.bookmarks.getTree();
  traverseTree(tree);
  return foldersMap;
}
