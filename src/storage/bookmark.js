import useConnection, { DB_NAME } from './idb/connection';
import readAllKeys from './idb/keys';
import escapeRegExp from './regex';

const buildTermRegex = (term) => {
  const regexPattern = term.split(/\s+/).map((word) => `(?=.*${escapeRegExp(word)})`).join('');
  return new RegExp(`^${regexPattern}.*$`, 'i');
};

const buildBookmarkWhere = (query) => {
  const queryParams = {};
  query.forEach(({ key, value }) => {
    (queryParams[key] ??= []).push(value);
  });

  const whereConditions = [];
  const conditions = [
    { key: 'folder', condition: { folderId: { in: queryParams.folder } } },
    { key: 'tag', condition: { tags: { in: queryParams.tag } } },
    { key: 'domain', condition: { domain: { in: queryParams.domain } } },
    { key: 'keyword', condition: { keywords: { in: queryParams.keyword } } },
    { key: 'id', condition: { id: { in: queryParams.id } } },
  ];
  conditions.forEach(({ key, condition }) => {
    if (queryParams[key]) {
      whereConditions.push(condition);
    }
  });
  if (queryParams.term) {
    const regex = buildTermRegex(queryParams.term[0]);
    whereConditions.push({
      title: { regex },
      or: {
        description: { regex },
        or: {
          url: { regex },
          or: {
            domain: { regex },
            or: {
              keywords: { regex },
            },
          },
        },
      },
    });
  }
  if (queryParams.dateAdded?.[0]) {
    const [startStr, endStr] = queryParams.dateAdded[0].split('~');
    const low = new Date(startStr).setHours(0, 0, 0, 0);
    const high = new Date(endStr).setHours(23, 59, 59, 999);
    whereConditions.push({ dateAdded: { '-': { low, high } } });
  }
  return whereConditions.length === 0 ? null : whereConditions;
};

const buildPinnedWhere = (term) => {
  const whereConditions = [{ pinned: 1 }];
  if (term) {
    const regex = buildTermRegex(term);
    whereConditions.push({
      notes: { regex },
      or: {
        title: { regex },
        or: {
          description: { regex },
          or: {
            domain: { regex },
          },
        },
      },
    });
  }
  return whereConditions;
};

const fetchSortedDuplicateGroups = async (connection) => {
  const groupedResults = await connection.select({
    from: 'bookmarks',
    groupBy: 'url',
    aggregate: { count: ['id'] },
  });
  const duplicateGroups = groupedResults.filter((group) => group['count(id)'] > 1);
  duplicateGroups.sort((a, b) => String(a.url).localeCompare(String(b.url)));
  return duplicateGroups;
};

const hydrateDuplicateGroups = async (connection, groups) => {
  if (groups.length === 0) return [];
  const urls = groups.map((group) => group.url);
  const allBookmarks = await connection.select({
    from: 'bookmarks',
    where: { url: { in: urls } },
    order: { by: 'dateAdded', type: 'desc' },
  });
  const bookmarksByUrl = Object.groupBy(allBookmarks, (b) => b.url);
  return groups.map((group) => {
    const bookmarks = bookmarksByUrl[group.url] || [];
    return {
      url: group.url,
      bookmarks,
      count: group['count(id)'],
      firstAdded: bookmarks[bookmarks.length - 1],
      lastAdded: bookmarks[0],
    };
  });
};

export default class BookmarkStorage {
  async createMany(data) {
    const connection = await useConnection();
    const result = await connection.insert({
      into: 'bookmarks',
      values: data,
      validation: false,
      skipDataCheck: true,
      ignore: true,
    });
    return result;
  }

  async findAfterId(id, limit) {
    const connection = await useConnection();
    const query = {
      from: 'bookmarks',
      limit,
      order: { by: 'id', type: 'asc' },
      where: id ? { id: { '>': id } } : null,
    };
    return connection.select(query);
  }

  async search(query, skip = 0, limit = 50, sortDirection = 'desc') {
    const connection = await useConnection();
    return connection.select({
      from: 'bookmarks',
      distinct: true,
      limit,
      skip,
      order: { by: 'dateAdded', type: sortDirection },
      where: buildBookmarkWhere(query),
    });
  }

  async total() {
    const connection = await useConnection();
    return connection.count({
      from: 'bookmarks',
    });
  }

  async create(entity) {
    const connection = await useConnection();
    return connection.insert({
      into: 'bookmarks',
      values: [entity],
    });
  }

  async updateHttpStatusById(id, status) {
    const connection = await useConnection();
    return connection.update({
      in: 'bookmarks',
      set: {
        httpStatus: parseInt(status, 10),
        updatedAt: new Date().toISOString(),
      },
      where: {
        id,
      },
    });
  }

  async setOK() {
    const connection = await useConnection();
    return connection.update({
      in: 'bookmarks',
      set: { httpStatus: 200 },
    });
  }

  async findPinned(skip = 0, limit = 50, term = '') {
    const connection = await useConnection();
    return connection.select({
      from: 'bookmarks',
      where: buildPinnedWhere(term),
      order: { by: 'updatedAt', type: 'desc' },
      limit,
      skip,
    });
  }

  async updatePinStatusById(id, status) {
    const connection = await useConnection();
    return connection.update({
      in: 'bookmarks',
      set: {
        pinned: parseInt(status, 10),
        updatedAt: new Date().toISOString(),
      },
      where: {
        id,
      },
    });
  }

  async update(id, data) {
    const connection = await useConnection();
    return connection.update({
      in: 'bookmarks',
      set: data,
      where: {
        id,
      },
    });
  }

  async removeByIds(ids) {
    const connection = await useConnection();
    const result = await connection.remove({
      from: 'bookmarks',
      where: {
        id: {
          in: ids,
        },
      },
    });
    return result;
  }

  async removeById(id) {
    const connection = await useConnection();
    return connection.remove({
      from: 'bookmarks',
      where: { id },
    });
  }

  async getIds(ids) {
    const connection = await useConnection();
    const response = await connection.select({
      from: 'bookmarks',
      where: {
        id: {
          in: ids,
        },
      },
    });
    return response.map((i) => i.id);
  }

  async getByFolderId(folderId) {
    const connection = await useConnection();
    const response = await connection.select({
      from: 'bookmarks',
      limit: 1,
      where: {
        folderId,
      },
    });

    return response.length === 1 ? response.shift() : null;
  }

  async updateBookmarksFolderName(folderId, folderName) {
    const connection = await useConnection();
    return connection.update({
      in: 'bookmarks',
      set: {
        folderName,
        updatedAt: new Date().toISOString(),
      },
      where: {
        folderId,
      },
    });
  }

  async getById(id) {
    const connection = await useConnection();
    const response = await connection.select({
      from: 'bookmarks',
      limit: 1,
      where: {
        id,
      },
    });

    return response.length === 1 ? response.shift() : null;
  }

  async getByUrl(url) {
    const connection = await useConnection();
    const response = await connection.select({
      from: 'bookmarks',
      limit: 1,
      where: {
        url: String(url),
      },
    });

    return response.length === 1 ? response.shift() : null;
  }

  async getTags() {
    const connection = await useConnection();
    const response = await connection.select({
      from: 'bookmarks',
      flatten: ['tags'],
      groupBy: 'tags',
      order: {
        by: 'tags',
        type: 'asc',
      },
    });
    return response.map((item) => item.tags);
  }

  async updateStatusByIds(status, ids) {
    const connection = await useConnection();
    return connection.update({
      in: 'bookmarks',
      set: {
        httpStatus: status,
      },
      where: {
        id: {
          in: ids,
        },
      },
    });
  }

  async updateNotesById(id, notes) {
    const connection = await useConnection();
    return connection.update({
      in: 'bookmarks',
      set: {
        notes,
        updatedAt: new Date().toISOString(),
      },
      where: {
        id,
      },
    });
  }

  async updateImageById(id, image) {
    const connection = await useConnection();
    return connection.update({
      in: 'bookmarks',
      set: {
        image,
      },
      where: {
        id,
      },
    });
  }

  async findByHttpStatus(statuses, skip = 0, limit = 50) {
    const connection = await useConnection();
    return connection.select({
      from: 'bookmarks',
      where: { httpStatus: { in: statuses } },
      order: { by: 'id', type: 'desc' },
      limit,
      skip,
    });
  }

  async getTotalByHttpStatus(statuses) {
    const connection = await useConnection();
    return connection.count({
      from: 'bookmarks',
      where: {
        httpStatus: {
          in: statuses,
        },
      },
    });
  }

  async getAllIds() {
    // make sure JsStore has created the database before reading it natively
    await useConnection();
    return readAllKeys(DB_NAME, 'bookmarks');
  }

  async getDuplicatesGrouped(skip = 0, limit = 50) {
    const connection = await useConnection();
    const duplicateGroups = await fetchSortedDuplicateGroups(connection);
    const paginatedGroups = duplicateGroups.slice(skip, skip + limit);
    const groups = await hydrateDuplicateGroups(connection, paginatedGroups);
    return {
      groups,
      total: duplicateGroups.length,
      hasMore: skip + limit < duplicateGroups.length,
    };
  }

  async aggregateByField(field, flatten = false) {
    const connection = await useConnection();
    const query = {
      from: 'bookmarks',
      groupBy: field,
      aggregate: { count: ['id'] },
    };
    if (flatten) query.flatten = [field];

    const rows = await connection.select(query);
    return rows
      .filter((r) => r[field])
      .map((r) => ({ field, value: r[field], count: r['count(id)'] }));
  }

  async aggregateDomains() {
    return this.aggregateByField('domain');
  }

  async aggregateTags() {
    return this.aggregateByField('tags', true);
  }

  async aggregateKeywords() {
    return this.aggregateByField('keywords', true);
  }
}
