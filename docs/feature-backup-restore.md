# 功能方案：备份、导出与恢复

- 日期：2026-09-28
- 状态：草案
- 基线代码：`fix/sync-p0` 分支（`3bace09`）
- 所属方向：书签大扫除（方向 A）第 1 步。后续的批量操作、一键修复都依赖本功能提供的"撤销和兜底"能力。

## 1. 背景与目标

### 1.1 现状：哪些数据会丢

| 数据 | 存放位置 | 随浏览器同步到其他设备 | 丢了能否重建 |
|---|---|---|---|
| 书签和文件夹结构 | 浏览器书签 | 是 | — |
| 标签 | 书签标题（`标题 🏷 #标签`） | 是 | — |
| **笔记** | 扩展的 IndexedDB（`bookmarks.notes`） | **否** | **不能** |
| **置顶（pinned）** | IndexedDB（`bookmarks.pinned`） | **否** | **不能** |
| **收藏时的页面截图** | IndexedDB（`bookmarks.image`，data URL） | 否 | **不能**（只在收藏当时截取） |
| 标题、描述、预览图地址、关键词 | IndexedDB | 否 | 能，重新抓取网页即可，但慢，且网页可能已失效 |
| 链接状态（httpStatus） | IndexedDB | 否 | 能，重新检测 |
| 设置（字号、视图模式、删除确认、主题） | 页面的 localStorage | 否 | 能，手动重设 |

重装扩展、换电脑、清除浏览器数据时，笔记、置顶和截图会**永久丢失**，而且现在没有任何导出手段。这和"本地优先"的定位相冲突：数据留在本地，就必须让用户能把数据带走。

### 1.2 目标

1. 用户可以一键把**所有数据**导出成一个文件，包括上表中的全部内容。
2. 用户可以从这个文件**恢复**：在重装后或新设备上找回笔记、置顶和截图；也可以把缺失的书签重建出来。
3. 恢复过程**绝不删除或覆盖**用户现有的书签。
4. 可以导出为浏览器通用的 HTML 书签格式，能导入任何浏览器，用户不会被这个扩展锁定。
5. 备份格式同时作为后续"批量操作前自动快照、一键撤销"的数据格式。

## 2. 需求

### 2.1 用户故事

- **重装恢复**：我重装了扩展，书签还在（浏览器同步回来了），但笔记和置顶都没了。我导入之前的备份文件，笔记和置顶都回来了，并且挂在正确的书签上。
- **换设备**：新电脑登录浏览器账号后书签同步过来了，我导入备份，笔记也过来了。
- **找回误删**：我误删了一个文件夹。我从备份恢复，缺失的书签会重建在一个名为"FavBox 恢复 2026-09-28"的新文件夹里，保持原有的层级结构，现有书签不受影响。
- **迁移到别的工具**：我导出 HTML 文件，导入到另一个浏览器或书签工具里，文件夹结构和标签都在，笔记作为书签描述保留。
- **备份提醒**：我有笔记但 30 天没备份了，设置页会提醒我。

### 2.2 功能范围

**导出**

| 项 | 说明 |
|---|---|
| JSON 完整备份 | 书签树加上每条书签在扩展里的全部数据，外加设置。可选"包含截图"（默认开启，勾选框旁显示预估文件大小） |
| HTML 导出 | Netscape 书签格式（各浏览器导入导出的通用格式）。标题保留原样（含 `🏷 #标签`），这样再导入回 FavBox 时标签不丢；标签另外写入 `TAGS` 属性，笔记转成纯文本写入 `<DD>` |
| 触发方式 | 设置页的按钮；文件名 `favbox-backup-YYYYMMDD-HHmm.json` / `.html` |

**恢复（只接受 JSON）**

浏览器自带"导入 HTML 书签"功能，而且现有代码已经处理了浏览器原生导入的事件（`onImportBegan` / `onImportEnded` 触发重新同步），所以 HTML 导入不需要自己做。

分三步：

1. **选择文件并校验**：格式、版本、大小、每条记录的字段合法性（见 4.5）。
2. **预览恢复计划**：先算出计划并展示，此时不做任何修改：
   - 可匹配到现有书签、将写回笔记、置顶或截图的条数；
   - 现有书签里不存在、可以重建的条数；
   - 被跳过的条数和原因（非网页链接、字段不合法等）；
   - 两个选项：`恢复笔记和置顶`（默认勾选）、`重建缺失的书签`（默认不勾选）。
3. **执行并报告**：显示进度，完成后给出结果汇总，并列出失败条目。

**不做（本期）：** 自动定时备份到磁盘（需要 `downloads` 权限，放到下一期）、"覆盖式"恢复（删除现有书签再还原）、从 Raindrop 或 Pocket 等第三方格式导入、云端备份。

### 2.3 验收标准

| 项 | 标准 |
|---|---|
| 往返一致 | 导出 → 清空扩展数据 → 导入：笔记、置顶、截图 100% 回到对应书签 |
| 不破坏现有数据 | 任何恢复操作后，原有书签的数量、标题、位置都不变（自动化测试断言） |
| 恢复不访问网络 | 恢复过程中不发起任何网页请求：元数据来自备份文件，不重新抓取 |
| 性能 | 1 万条书签（不含截图）导出 ≤ 3s；重建 1000 条书签 ≤ 30s |
| 安全 | 恶意或损坏文件（见 4.5 的用例）被拒绝或逐条跳过，不会执行脚本，也不会创建 `javascript:` 书签 |
| 可移植 | 导出的 HTML 文件能被 Chrome、Firefox、Edge 正常导入，文件夹层级正确 |

## 3. 关键难点

### 3.1 书签 id 不能跨设备使用

扩展数据以浏览器书签 id 为主键，但 id 只在单个浏览器配置文件内有效：Chrome 是本机自增的数字，Firefox 是 GUID，换设备或重装后 id 全变。**恢复时不能按 id 匹配，必须按内容匹配。**

匹配规则（`matchBookmarks`）：

1. 对 URL 做规范化后作为主键：去掉末尾的 `/`、去掉 `#` 片段、主机名转小写。查询参数保留，因为它常常决定页面内容。
2. 同一 URL 只有一个候选时，直接匹配。
3. 同一 URL 有多个候选时，按以下顺序比较：文件夹路径和标题都相同 → 标题相同 → 按 `dateAdded` 最接近的；已被匹配过的候选不再参与。
4. 匹配不到的条目归入"缺失，可重建"。

### 3.2 恢复时要避免触发大量网页抓取

每创建一个书签都会触发 `onCreated`，它会去抓取网页元数据；重建 1000 条就是 1000 次抓取，而备份里本来就有这些元数据。

做法：复用现有的 `nativeImport` 开关（`storage.session`，扩展页面可读写）。

1. 设置 `nativeImport = true`，让 `onCreated` 直接返回；
2. 创建文件夹和书签，记录"新 id ↔ 备份条目"的对应关系；
3. 用备份里的元数据加上新的 id、文件夹、`dateAdded` 拼成记录，直接用 `createMany` 写入 IndexedDB；
4. 刷新属性统计（`refreshFromAggregated`）；
5. 在 `finally` 里恢复 `nativeImport = false`，保证出错也会复原。

这样下次同步时 id 集合已经一致，不会再去抓取。

### 3.3 已知限制

- `bookmarks.create` 不能指定 `dateAdded`，重建的书签添加时间会变成恢复当天。数据库里可以写回原始时间，让本机的按日期排序和筛选保持原样，但其他设备看到的仍是新时间。方案：数据库写回原始时间，在恢复报告里说明这一点。
- 重建的书签会经浏览器同步出现在所有设备上。预览步骤要明确提示这一点。

## 4. 技术方案

### 4.1 模块划分：先生成计划，再执行

所有判断逻辑都是纯函数，输入是数据，输出是计划，方便单测和预览展示；只有 `apply*` 函数调用浏览器 API 和数据库。

| 文件 | 内容 | 类型 |
|---|---|---|
| `src/backup/format.js` | 格式常量、`buildBackup(tree, entities, settings, options)` | 纯函数 |
| `src/backup/validate.js` | `validateBackup(json)` → `{ backup, errors, skipped }` | 纯函数 |
| `src/backup/match.js` | `normalizeUrl`、`matchBookmarks(backupEntries, currentEntries)` | 纯函数 |
| `src/backup/plan.js` | `planRestore(backup, currentTree, options)` → `{ updates, creates, skipped }` | 纯函数 |
| `src/backup/netscape.js` | `toNetscapeHtml(tree, entities)`，包含 HTML 转义 | 纯函数 |
| `src/backup/apply.js` | `applyDataUpdates(plan)`、`applyCreates(plan)`，调用书签 API 和存储层 | 有副作用 |
| `src/backup/download.js` | Blob 加 `<a download>` 触发下载，不需要新权限 | 有副作用 |
| `src/ext/browser/components/BackupPanel.vue` | 设置页里的导出、导入、预览、进度、报告界面 | 界面 |

存储层补一个方法：`BookmarkStorage.findAll()`，内部用已有的 `findAfterId` 分页遍历，每页 100 条。

### 4.2 JSON 格式（version 1）

```json
{
  "format": "favbox-backup",
  "version": 1,
  "exportedAt": "2026-09-28T10:00:00.000Z",
  "app": { "name": "favbox", "version": "2.2.0" },
  "source": { "browser": "chrome" },
  "options": { "includeScreenshots": true },
  "settings": { "fontSize": "md", "viewMode": "masonry", "skipDeleteConfirmation": false, "theme": "auto" },
  "tree": [
    {
      "type": "folder",
      "title": "Bookmarks bar",
      "children": [
        {
          "type": "bookmark",
          "title": "Tokio 源码解读 🏷 #rust #async",
          "url": "https://example.com/tokio",
          "dateAdded": 1700000000000,
          "data": {
            "notes": "<p>第三节讲调度器</p>",
            "pinned": 1,
            "description": "…",
            "favicon": "https://example.com/favicon.ico",
            "image": "https://example.com/og.png",
            "keywords": ["rust"],
            "httpStatus": 200
          }
        }
      ]
    }
  ]
}
```

设计要点：

- 按树形保存，可以完整还原文件夹层级；扩展数据直接挂在对应书签节点上，不需要另外维护 id 映射。
- **不保存书签 id**：换了设备 id 没有意义，还容易被误用。
- 标签不单独存：它们本来就在 `title` 里，由 `extractTags` 解析。
- 根节点（书签栏、其他书签等）的名字随浏览器和语言不同。恢复时按位置对应：第 1 个根对应书签栏，第 2 个对应其他书签，依此类推；对应不上就放进恢复文件夹。
- 以后格式变化时 `version` 递增，`validate.js` 负责把旧版本升级到新版本。

### 4.3 导出流程

1. 并行读取 `browser.bookmarks.getTree()`、`BookmarkStorage.findAll()` 和设置。
2. 按 id 把数据库记录挂到树节点上；数据库里没有记录的书签（比如同步还没完成）只导出树节点本身。
3. 不含截图时，删掉以 `data:` 开头的 `image`，保留普通的图片网址。
4. 序列化后下载，把 `lastBackupAt` 写入 `storage.local`。
5. 预估大小：导出前遍历一遍，统计 `data:` 截图的总长度，显示在勾选框旁边。

### 4.4 恢复流程

```
选择文件 → 读取为文本（上限 200MB）→ JSON.parse → validateBackup
  → 读取当前书签树和数据库记录 → planRestore → 展示预览
  → 用户确认 → applyDataUpdates（只改数据库）
             → [勾选"重建缺失"时] applyCreates（设置 nativeImport → 建文件夹和书签 → 写入数据库 → finally 复原开关）
  → refreshFromAggregated → 通知已打开的页面刷新（沿用现有的 { action: 'refresh' } 消息）→ 显示报告
```

`applyDataUpdates` 只更新 `notes`、`pinned`、`image` 三个字段，并且规则保守：

- 现有笔记为空时，直接写入；
- 现有笔记和备份不同时，**不覆盖**，把备份内容追加在后面，中间加一条分隔线，并在报告里计为"合并"；
- `pinned`：备份里是 1 就设为 1，不会把现有的置顶取消；
- `image`：只在现有记录没有图片时写入。

### 4.5 输入校验与安全

备份文件属于不可信的外部输入，校验规则：

| 检查项 | 规则 | 不通过时 |
|---|---|---|
| 文件大小 | ≤ 200MB | 整个文件拒绝 |
| 顶层结构 | `format === 'favbox-backup'`；`version` 是已知版本；`tree` 是数组 | 整个文件拒绝 |
| 树深度和节点数 | 深度 ≤ 50，节点数 ≤ 20 万 | 整个文件拒绝 |
| `url` | 能被 `new URL` 解析，协议只允许 `http:`、`https:` | 跳过该条（阻止 `javascript:`、`data:`、`file:` 等） |
| `title` | 字符串，长度 ≤ 4096 | 截断 |
| `notes` | 字符串，长度 ≤ 1MB | 跳过该字段 |
| `image` | 以 `data:image/` 开头，或是 `http(s)` 网址；单条 ≤ 2MB | 跳过该字段 |
| `pinned`、`httpStatus`、`dateAdded` | 类型为数字且在合理范围内 | 用默认值 |
| 未知字段 | 忽略，不写入数据库 | — |

笔记是 HTML。**约束：项目里任何地方都不得用 `v-html` 渲染笔记。** 笔记只进 TipTap 编辑器，由编辑器按自己的内容规则解析，会丢掉 `<script>` 和事件属性。在 `validate.js` 的注释和 ESLint 配置里加上 `vue/no-v-html: error`，把这条约束固定下来。

HTML 导出时，`title`、`url`、笔记全部做 HTML 转义，避免生成的文件被其他工具导入时出现注入问题。

### 4.6 备份提醒

- `storage.local.lastBackupAt` 记录上次导出时间。
- 设置页显示"上次备份：N 天前 / 从未备份"。
- 有笔记或置顶，且超过 30 天未备份时，主界面顶部显示一次可关闭的提示。

## 5. 测试

按现有 TDD 流程，vitest 加 fake-indexeddb：

| 测试 | 重点用例 |
|---|---|
| `format.spec.js` | 数据挂接正确；不含截图时只删 `data:` 图片；数据库里没有记录的书签照常导出 |
| `validate.spec.js` | 恶意用例：`javascript:` 地址、超长字段、深度嵌套、错误版本、非 JSON、`notes` 为对象、`__proto__` 键 |
| `match.spec.js` | URL 规范化；同一 URL 多个候选时按优先级匹配；已匹配的候选不重复使用 |
| `plan.spec.js` | 更新、重建、跳过的分类；根节点按位置对应 |
| `netscape.spec.js` | 转义正确；层级正确；`TAGS` 与 `<DD>` 输出 |
| `apply.spec.js` | 恢复期间 `nativeImport` 为 true，出错后也会复原；**恢复前后原有书签不变**；恢复期间 `fetch` 未被调用 |
| 往返测试 | 导出 → 清空 → 导入，数据完全一致 |

手动验证：在 Chrome、Firefox、Edge 中各导入一次导出的 HTML 文件。

## 6. 任务拆分

| # | 任务 | 预计 |
|---|---|---|
| 1 | `format` + `findAll` + 下载（导出 JSON 可用） | 3h |
| 2 | `validate`（含恶意用例） | 3h |
| 3 | `match` + `plan` | 4h |
| 4 | `apply`（数据回写、重建、`nativeImport` 处理） | 4h |
| 5 | `netscape` HTML 导出 | 2h |
| 6 | `BackupPanel.vue`：导出、导入、预览、进度、报告，以及备份提醒 | 5h |
| 7 | 往返测试、三个浏览器的手动验证、`vue/no-v-html` 规则 | 2h |

合计约 23 小时，即 3 个工作日左右。

## 7. 已定决策

- **界面语言（2026-09-28）**：先把英文版功能做完整，之后再接入多语言并支持中文。本功能的界面文字用英文，与现有界面一致。为了之后接入多语言时改动小，界面文字集中写在组件的一处常量里，不要散落在模板中。
- **笔记冲突（2026-09-28）**：采用 4.4 的"追加合并"，不做逐条选择。

## 8. 待确认问题

1. **自动备份**：下一期是否要加 `downloads` 权限做定时自动备份？新增权限在更新时会弹窗让用户确认，可能影响已有用户的更新意愿。
