<template>
  <div
    class="material-library"
    :class="{ 'page-dragover': dragging }"
    @dragenter.prevent="onDragEnter"
    @dragover.prevent="onDragOver"
    @dragleave.prevent="onDragLeave"
    @drop.prevent="onDrop">
    <header class="module-page-header material-header">
      <div class="module-page-title">
        <span class="module-page-icon">🗃️</span>
        <div class="module-page-copy">
          <div class="module-page-kicker">MATERIAL NAS</div>
          <h2>素材库</h2>
        </div>
      </div>
      <div class="type-tabs">
        <button
          v-for="(label, type) in typeLabels"
          :key="type"
          class="type-tab"
          :class="{ active: materialType === type }"
          @click="switchType(type)">
          {{ label }}
        </button>
      </div>
      <div class="header-actions module-page-actions">
        <button class="btn btn-ghost btn-sm" @click="triggerUpload()">上传素材</button>
        <button class="btn btn-ghost btn-sm" @click="loadList()" :disabled="loading">刷新</button>
        <span class="stat-pill">当前 {{ total }} 个 · {{ formatSize(totalSize) }}</span>
        <button class="btn btn-ghost btn-sm" @click="toggleBasketOpen">剪辑篮 {{ clipBasketCount }}</button>
        <button class="btn btn-ghost btn-sm" @click="runUndo" :disabled="!undoStack.length">撤回 Ctrl+Z</button>
        <span v-if="uploadMsg" class="upload-msg" :class="uploadMsgType">{{ uploadMsg }}</span>
      </div>
    </header>

    <div class="nas-layout">
      <aside class="nas-sidebar">
        <section
          class="upload-zone"
          :class="{ dragover: dragging }"
          @click="triggerUpload()"
          @drop.prevent.stop="onDrop"
          @dragenter.prevent.stop="onDragEnter"
          @dragover.prevent.stop="onDragOver"
          @dragleave.prevent.stop="onDragLeave">
          <div class="upload-icon">+</div>
          <div class="upload-title">拖拽或点击上传</div>
          <div class="upload-sub">上传到内网文件系统：{{ currentFolderLabel }}</div>
          <div v-if="uploading" class="upload-progress">
            <div class="upload-file-row">
              <span :title="uploadCurrentName">{{ uploadQueueText }} {{ uploadCurrentName || '上传中' }}</span>
              <strong>{{ uploadCurrentPct }}%</strong>
            </div>
            <div class="progress-bar"><div class="progress-fill" :style="{ width: uploadPct + '%' }"></div></div>
            <div class="upload-speed-row">
              <span>{{ uploadSpeedText || '计算速率...' }}</span>
              <span v-if="uploadEtaText">剩余 {{ uploadEtaText }}</span>
              <span>总进度 {{ uploadPct }}%</span>
            </div>
          </div>
        </section>
        <input ref="uploadInputRef" type="file" :accept="typeExts[materialType]" multiple hidden @change="onFileSelect" />

        <section class="tree-panel">
          <div class="panel-head">
            <div>
              <span>目录</span>
              <strong>{{ typeLabels[materialType] }}</strong>
            </div>
            <button class="mini-btn" @click="loadFolders" :disabled="folderLoading">刷新</button>
          </div>
          <div class="tree-list">
            <div class="tree-row" :class="{ active: currentFolder === ALL_FOLDER }" @click="selectFolder(ALL_FOLDER)">
              <span class="tree-icon">◎</span>
              <span class="tree-name">全部素材</span>
              <em>{{ storage?.indexed_count || 0 }}</em>
            </div>
            <div class="tree-row" :class="{ active: currentFolder === '/' }" @click="selectFolder('/')">
              <span class="tree-icon">/</span>
              <span class="tree-name">根目录</span>
              <em>{{ rootFolderStats.count || 0 }}</em>
            </div>
            <div
              v-for="folder in folderRows"
              :key="folder.id"
              class="tree-row"
              :style="{ paddingLeft: 12 + folder.level * 16 + 'px' }"
              :class="{ active: currentFolder === folder.path, dragover: dragOverFolder === folder.path }"
              @contextmenu.stop="showFolderCtxMenu($event, folder)"
              @dragover.prevent="dragOverFolderPath(folder.path)"
              @dragleave="dragOverFolderPath('')"
              @drop.prevent.stop="dropItemToFolder(folder.path, $event)"
              @click="selectFolder(folder.path)">
              <button
                v-if="hasFolderChildren(folder)"
                class="tree-toggle"
                :class="{ open: isFolderOpen(folder.path) }"
                :title="isFolderOpen(folder.path) ? '收起子文件夹' : '展开子文件夹'"
                @click.stop="toggleFolderOpen(folder.path)">
                {{ isFolderOpen(folder.path) ? '▾' : '▸' }}
              </button>
              <span v-else class="tree-toggle tree-toggle-empty"></span>
              <span class="tree-icon">▸</span>
              <span class="tree-name" :title="folder.path">{{ folder.name }}</span>
              <em :title="'本层 ' + (folder.count || 0) + ' / 含子目录 ' + (folder.deep_count || folder.count || 0)">
                {{ folder.deep_count || folder.count || 0 }}
              </em>
              <button class="tree-delete" title="删除文件夹和素材" @click.stop="removeFolder(folder)">×</button>
            </div>
            <div v-if="folderLoading" class="tree-hint">目录加载中...</div>
            <div v-else-if="!folderRows.length" class="tree-hint">还没有子文件夹</div>
          </div>
        </section>

        <section class="storage-card">
          <span>存储概览</span>
          <strong>{{ formatSize(storage?.indexed_size || 0) }}</strong>
          <p>已入库 {{ storage?.indexed_count || 0 }} 个素材</p>
          <p>内网文件系统 {{ storage?.remote_count || 0 }} 个文件 · {{ formatSize(storage?.remote_size || 0) }}</p>
          <small :title="storage?.root">{{ storage?.storage_mode === 'internal-file-store' ? '内网文件系统已启用' : '兼容模式：服务端暂存' }}</small>
        </section>
      </aside>

      <main class="nas-main" :class="{ 'has-detail': detailItem || detailFolder }" @contextmenu="showBlankCtxMenu($event)">
        <section class="nas-toolbar">
          <div class="breadcrumb">
            <button
              v-for="(item, index) in breadcrumbItems"
              :key="item.path"
              @click="selectFolder(item.path)">
              {{ item.label }}<span v-if="index < breadcrumbItems.length - 1">/</span>
            </button>
          </div>
          <div class="toolbar-stack">
            <div class="toolbar-actions">
              <input class="inp search-inp" v-model="searchText" placeholder="搜索人物/项目/用途，例如：采访、评论截图、名场面" @input="debouncedSearch" />
              <select class="inp select-inp" v-model="sortBy" @change="changeSort(sortBy)">
                <option value="created_at">时间</option>
                <option value="name">名称</option>
                <option value="size">大小</option>
                <option value="duration">时长</option>
                <option value="category">分类</option>
              </select>
              <button class="btn btn-ghost btn-sm" @click="toggleSortDir">{{ sortDir === 'desc' ? '降序' : '升序' }}</button>
              <button class="btn btn-ghost btn-sm" :class="{ active: viewMode === 'grid' }" @click="setViewMode('grid')">网格</button>
              <button class="btn btn-ghost btn-sm" :class="{ active: viewMode === 'list' }" @click="setViewMode('list')">列表</button>
            </div>
            <div class="quick-use-strip">
              <span>剪辑用途</span>
              <button
                v-for="tag in EDIT_USE_TAGS"
                :key="tag"
                class="use-chip"
                type="button"
                @click="applyQuickSearch(tag)">
                {{ tag }}
              </button>
            </div>
          </div>
          <div class="folder-create">
            <input class="inp folder-input" v-model="newFolderName" placeholder="新建文件夹" @keyup.enter="createCurrentFolder" />
            <button class="btn btn-ghost btn-sm" @click="createCurrentFolder" :disabled="creatingFolder">新建</button>
          </div>
        </section>

        <section class="category-strip">
          <button class="cat-chip" :class="{ active: selectedCat === ALL_CATEGORY }" @click="selectCategory(ALL_CATEGORY)">全部</button>
          <button
            v-for="cat in categories"
            :key="cat.category"
            class="cat-chip"
            :class="{ active: selectedCat === cat.category }"
            @click="selectCategory(cat.category)">
            {{ cat.category }} {{ cat.cnt }}
          </button>
        </section>

        <section class="content-section">
          <div class="section-title">
            <span>当前目录</span>
            <em>{{ visibleFolders.length }} 个文件夹 · {{ total }} 个素材 · {{ formatSize(totalSize) }}</em>
          </div>

          <div v-if="projectBindingHint && !selectedCount" class="context-bar">
            <span>{{ projectBindingHint }}</span>
          </div>

          <div v-if="selectedCount" class="bulk-bar">
            <strong>已选择 {{ selectedCount }} 个素材</strong>
            <button class="btn btn-ghost btn-sm" @click="selectAllVisible">全选当前页</button>
            <span v-if="projectBindingHint" class="bulk-hint">{{ projectBindingHint }}</span>
            <select class="inp bulk-select" v-model="bulkMoveTarget" :disabled="bulkMoving">
              <option value="">移动到...</option>
              <option v-for="folder in folderOptions" :key="folder.path" :value="folder.path">{{ folder.label }} · {{ folder.count }} 个</option>
            </select>
            <button class="btn btn-ghost btn-sm" @click="batchMoveSelected()" :disabled="bulkMoving || !bulkMoveTarget">移动到目标目录</button>
            <button class="btn btn-ghost btn-sm" @click="batchAiTagSelected" :disabled="bulkAiTagging">批量 AI 标签</button>
            <select class="inp bulk-select project-bind-select" v-model.number="bindProjectId" :disabled="projectBinding" @change="changeBindProject(bindProjectId)">
              <option :value="0">关联项目...</option>
              <option v-for="project in projectOptions" :key="project.id" :value="project.id">{{ project.name }}</option>
            </select>
            <select class="inp bulk-select project-bind-task" v-model.number="bindTaskId" :disabled="projectBinding || !bindProjectId">
              <option :value="0">不指定任务</option>
              <option v-for="task in projectTaskOptions" :key="task.id" :value="task.id">{{ task.label }}</option>
            </select>
            <button class="btn btn-ghost btn-sm" @click="batchBindProjectTask" :disabled="projectBinding || !bindProjectId">绑定项目任务</button>
            <button class="btn btn-ghost btn-sm danger" @click="batchDeleteSelected">批量删除</button>
            <button class="btn btn-ghost btn-sm" @click="clearSelection">取消选择</button>
          </div>

          <div v-if="loading" class="material-grid">
            <div v-for="i in 8" :key="i" class="skeleton-card">
              <div class="skeleton skeleton-thumb"></div>
              <div class="skeleton skeleton-line"></div>
              <div class="skeleton skeleton-line short"></div>
            </div>
          </div>

          <div v-else-if="!visibleFolders.length && list.length === 0" class="list-empty">
            <div class="empty-icon">∅</div>
            <div class="empty-text">当前目录没有素材</div>
            <div class="empty-sub">可以新建子文件夹、上传素材，或从智能采片自动入库。</div>
          </div>

          <div v-else-if="viewMode === 'grid'" class="material-grid explorer-grid anim-fade-up stagger-children">
            <article
              v-for="folder in visibleFolders"
              :key="'folder-' + folder.id"
              class="explorer-folder-card"
              :class="{ dragover: dragOverFolder === folder.path }"
              draggable="true"
              tabindex="0"
              @dragstart="startDragFolder(folder)"
              @dragend="clearDragState"
              @click="selectFolder(folder.path)"
              @keydown.enter.prevent="selectFolder(folder.path)"
              @dragover.prevent="dragOverFolderPath(folder.path)"
              @dragleave="dragOverFolderPath('')"
              @drop.prevent.stop="dropItemToFolder(folder.path, $event)"
              @contextmenu.stop="showFolderCtxMenu($event, folder)">
              <div class="explorer-folder-icon">▰</div>
              <div class="explorer-folder-info">
                <strong :title="folder.name">{{ folder.name }}</strong>
                <span :title="folder.path">{{ folder.path }}</span>
                <em>{{ folder.children_count || 0 }} 个子文件夹 · {{ folder.deep_count || folder.count || 0 }} 个素材</em>
              </div>
              <div class="explorer-folder-actions">
                <button title="重命名文件夹" @click.stop="quickRenameFolder(folder)">重命名</button>
                <button title="查看详情" @click.stop="openFolderDetail(folder)">详情</button>
                <button title="删除文件夹和素材" @click.stop="removeFolder(folder)">删除</button>
              </div>
            </article>
            <article
              v-for="item in list"
              :key="item.id"
              class="material-card"
              :class="{ selected: isSelected(item) }"
              draggable="true"
              @dragstart="startDragItem(item)"
              @dragend="clearDragState"
              @click="openDetail(item)"
              @contextmenu.stop="showCardCtxMenu($event, item)">
              <label class="select-check" @click.stop>
                <input type="checkbox" :checked="isSelected(item)" @change="toggleSelect(item)" />
              </label>
              <div class="material-thumb" @click="openPreview(item)">
                <img v-if="item.thumb" :src="item.thumb" @error="(e) => e.target.style.display='none'" />
                <div v-else class="thumb-placeholder">{{ fileTypeLabel(item) }}</div>
                <div v-if="item.type === 'video'" class="play-overlay">播放</div>
                <div v-if="item.duration" class="material-duration">{{ formatDuration(item.duration) }}</div>
              </div>
              <div class="material-info">
                <div class="material-name" :title="item.original">{{ item.original }}</div>
                <div class="material-path" :title="item.folder">{{ item.folder || '/' }}</div>
                <div class="material-meta">
                  <span class="cat-badge">{{ item.category }}</span>
                  <span>{{ formatSize(item.size) }}</span>
                </div>
                <div class="use-row">
                  <span class="use-label">用途</span>
                  <template v-if="materialUseTags(item).length">
                    <span v-for="tag in materialUseTags(item)" :key="tag" class="use-chip active">{{ tag }}</span>
                  </template>
                  <span v-else class="use-empty">未标用途</span>
                </div>
                <div class="material-tags" v-if="item.tags && item.tags.length">
                  <span v-for="t in item.tags" :key="t" class="tag-chip">{{ t }}</span>
                </div>
                <div class="material-actions">
                  <button class="btn btn-ghost btn-sm" @click.stop="addToClipBasket(item)">剪辑篮</button>
                  <button class="btn btn-ghost btn-sm" @click.stop="runAiTag(item)" :disabled="aiTaggingId === item.id">{{ aiTaggingId === item.id ? '识别中' : 'AI标签' }}</button>
                  <button class="btn btn-ghost btn-sm" @click.stop="quickRenameMaterial(item)">重命名</button>
                  <button class="btn btn-ghost btn-sm" @click.stop="openEdit(item)">编辑</button>
                </div>
              </div>
            </article>
          </div>

          <div v-else class="material-table">
            <div class="table-row table-head">
              <span>名称</span><span>路径</span><span>上传人</span><span>分类 / 标签</span><span>项目</span><span>大小</span><span>时间</span><span>操作</span>
            </div>
            <div
              v-for="folder in visibleFolders"
              :key="'folder-row-' + folder.id"
              class="table-row folder-table-row"
              :class="{ dragover: dragOverFolder === folder.path }"
              draggable="true"
              @dragstart="startDragFolder(folder)"
              @dragend="clearDragState"
              @click="selectFolder(folder.path)"
              @dblclick="selectFolder(folder.path)"
              @dragover.prevent="dragOverFolderPath(folder.path)"
              @dragleave="dragOverFolderPath('')"
              @drop.prevent.stop="dropItemToFolder(folder.path, $event)"
              @contextmenu.stop="showFolderCtxMenu($event, folder)">
              <span class="file-name folder-name-cell">
                <span class="folder-row-icon">▰</span>
                <span>{{ folder.name }}</span>
              </span>
              <span class="path-cell" :title="folder.path">{{ folder.path }}</span>
              <span class="owner-cell">-</span>
              <span class="tag-cell">
                <em>文件夹</em>
                <small>{{ folder.children_count || 0 }} 个子文件夹 / {{ folder.deep_count || folder.count || 0 }} 个素材</small>
              </span>
              <span class="project-cell">-</span>
              <span>{{ formatSize(folder.deep_size || folder.size || 0) }}</span>
              <span>{{ formatDate(folder.created_at) || '-' }}</span>
              <span class="table-actions">
                <button @click.stop="quickRenameFolder(folder)">重命名</button>
                <button @click.stop="openFolderDetail(folder)">详情</button>
                <button @click.stop="selectFolder(folder.path)">打开</button>
              </span>
            </div>
            <div
              v-for="item in list"
              :key="item.id"
              class="table-row"
              :class="{ selected: isSelected(item) }"
              draggable="true"
              @dragstart="startDragItem(item)"
              @dragend="clearDragState"
              @click="openDetail(item)"
              @dblclick="openPreview(item)"
              @contextmenu.stop="showCardCtxMenu($event, item)">
              <span class="file-name check-name">
                <input type="checkbox" :checked="isSelected(item)" @click.stop @change="toggleSelect(item)" />
                <span>{{ item.original }}</span>
              </span>
              <span class="path-cell" :title="item.folder || '/'">{{ item.folder || '/' }}</span>
              <span class="owner-cell" :title="item.uploader || '-'">{{ item.uploader || '-' }}</span>
              <span class="tag-cell">
                <em>{{ item.category || '-' }}</em>
                <small>{{ (item.tags || []).join(' / ') || '-' }}</small>
              </span>
              <span class="project-cell">{{ (item.project_names || item.projects || []).join?.(' / ') || '-' }}</span>
              <span>{{ formatSize(item.size) }}</span>
              <span>{{ formatDate(item.created_at) || '-' }}</span>
              <span class="table-actions">
                <button @click.stop="addToClipBasket(item)">剪辑篮</button>
                <button @click.stop="openPreview(item)">预览</button>
                <button @click.stop="quickRenameMaterial(item)">重命名</button>
                <button @click.stop="openEdit(item)">编辑</button>
              </span>
            </div>
          </div>

          <div v-if="!loading && total > pageSize" class="pager-row">
            <button class="btn btn-ghost btn-sm" @click="prevPage" :disabled="page <= 1">上一页</button>
            <span class="pager-info">{{ page }} / {{ totalPages() }}</span>
            <button class="btn btn-ghost btn-sm" @click="nextPage" :disabled="page >= totalPages()">下一页</button>
          </div>
        </section>
      </main>
      <aside v-if="detailItem || detailFolder" class="detail-panel">
        <div class="detail-head">
          <span>{{ detailFolder ? '文件夹详情' : '素材详情' }}</span>
          <button @click="closeDetail">关闭</button>
        </div>
        <template v-if="detailFolder">
          <div class="detail-folder-icon">▰</div>
          <h3 :title="detailFolder.name">{{ detailFolder.name }}</h3>
          <p class="detail-path" :title="detailFolder.path">{{ detailFolder.path }}</p>
          <div class="detail-meta">
            <span>父目录</span><strong>{{ detailFolder.parent || '/' }}</strong>
            <span>本层素材</span><strong>{{ detailFolder.count || 0 }}</strong>
            <span>全部素材</span><strong>{{ detailFolder.deep_count || detailFolder.count || 0 }}</strong>
            <span>子文件夹</span><strong>{{ detailFolder.children_count || 0 }}</strong>
            <span>容量</span><strong>{{ formatSize(detailFolder.deep_size || detailFolder.size || 0) }}</strong>
          </div>
          <div class="detail-actions">
            <button class="btn btn-ghost btn-sm" @click="selectFolder(detailFolder.path)">打开</button>
            <button class="btn btn-ghost btn-sm" @click="quickRenameFolder(detailFolder)">重命名</button>
            <button class="btn btn-ghost btn-sm danger" @click="removeFolder(detailFolder)">删除</button>
          </div>
        </template>
        <template v-else>
        <div class="detail-preview" @click="openPreview(detailItem)">
          <img v-if="detailItem.thumb" :src="detailItem.thumb" />
          <div v-else>{{ fileTypeLabel(detailItem) }}</div>
        </div>
        <h3 :title="detailItem.original">{{ detailItem.original }}</h3>
        <p class="detail-path" :title="detailItem.folder">{{ detailItem.folder || '/' }}</p>
        <div class="detail-meta">
          <span>分类</span><strong>{{ detailItem.category || '待分类' }}</strong>
          <span>大小</span><strong>{{ formatSize(detailItem.size) }}</strong>
          <span>时长</span><strong>{{ detailItem.duration ? formatDuration(detailItem.duration) : '-' }}</strong>
          <span>类型</span><strong>{{ detailItem.type }}</strong>
          <span>上传人</span><strong>{{ detailItem.uploader || '-' }}</strong>
          <span>创建时间</span><strong>{{ formatDate(detailItem.created_at) || '-' }}</strong>
        </div>
        <div class="detail-tags" v-if="detailItem.tags && detailItem.tags.length">
          <span v-for="tag in detailItem.tags" :key="tag">{{ tag }}</span>
        </div>
        <div class="detail-use-panel">
          <div class="detail-section-head">
            <strong>剪辑用途</strong>
            <span>智能裁片会优先按这些标签匹配素材</span>
          </div>
          <div class="detail-use-tags">
            <button
              v-for="tag in EDIT_USE_TAGS"
              :key="tag"
              class="use-chip"
              :class="{ active: hasUseTag(detailItem, tag) }"
              type="button"
              @click="toggleUseTagForItem(detailItem, tag)">
              {{ tag }}
            </button>
          </div>
        </div>
        <div class="detail-actions">
          <button class="btn btn-ghost btn-sm" @click="addToClipBasket(detailItem)">加入剪辑篮</button>
          <button class="btn btn-ghost btn-sm" @click="quickRenameMaterial(detailItem)">重命名</button>
          <button class="btn btn-ghost btn-sm" @click="openEdit(detailItem)">编辑</button>
          <button class="btn btn-ghost btn-sm" @click="runAiTag(detailItem)" :disabled="aiTaggingId === detailItem.id">AI 标签</button>
          <button class="btn btn-ghost btn-sm" @click="downloadFile(detailItem)">下载</button>
          <button class="btn btn-ghost btn-sm danger" @click="deleteItem(detailItem)">删除</button>
        </div>
        </template>
      </aside>
    </div>

    <div v-if="basketOpen" class="basket-panel">
      <div class="basket-head">
        <strong>剪辑篮</strong>
        <div>
          <button @click="clearClipBasket">清空</button>
          <button @click="toggleBasketOpen">关闭</button>
        </div>
      </div>
      <div v-if="!clipBasketItems.length" class="basket-empty">当前类型还没有加入素材</div>
      <div v-else class="basket-list">
        <div v-for="item in clipBasketItems" :key="item.id" class="basket-item">
          <img v-if="item.thumb" :src="item.thumb" />
          <span>{{ item.original }}</span>
          <button @click="removeFromClipBasket(item.id)">移除</button>
        </div>
      </div>
    </div>

    <div v-if="previewItem" class="preview-modal" @click.self="previewItem = null">
      <div class="preview-box">
        <div class="preview-hdr">
          <span class="preview-title">{{ previewItem.original }}</span>
          <button class="preview-close" @click="previewItem = null">关闭</button>
        </div>
        <div v-if="previewItem.type === 'video'" class="preview-media">
          <video :src="previewItem.url || ('/uploads/video/' + previewItem.filename)" controls autoplay></video>
        </div>
        <div v-else-if="previewItem.type === 'image'" class="preview-media image">
          <img :src="previewItem.url || ('/uploads/image/' + previewItem.filename)" />
        </div>
        <div v-else-if="previewItem.type === 'bgm'" class="preview-audio">
          <div class="audio-icon">BGM</div>
          <audio :src="previewItem.url || ('/uploads/bgm/' + previewItem.filename)" controls></audio>
        </div>
      </div>
    </div>

    <div v-if="editItem" class="preview-modal" @click.self="editItem = null">
      <div class="preview-box edit-box">
        <div class="preview-hdr">
          <span class="preview-title">编辑素材</span>
          <button class="preview-close" @click="editItem = null">关闭</button>
        </div>
        <div class="edit-form">
          <label class="input-group">
            <span>素材名称</span>
            <input class="inp" v-model="editName" placeholder="素材名称" />
          </label>
          <label class="input-group">
            <span>分类</span>
            <input class="inp" v-model="editCategory" placeholder="口播 / 场景 / BGM" />
          </label>
          <label class="input-group">
            <span>标签</span>
            <input class="inp" v-model="editTagsStr" placeholder="多个标签用逗号分隔" />
          </label>
          <div v-if="materialType === 'bgm'" class="input-group">
            <span>BGM 预设标签</span>
            <div class="bgm-tag-presets">
              <button
                v-for="tag in BGM_TAGS"
                :key="tag"
                type="button"
                class="bgm-tag-btn"
                :class="{ active: editTagsStr.includes(tag) }"
                @click="toggleBgmTag(tag)">
                {{ tag }}
              </button>
            </div>
          </div>
          <div class="edit-actions">
            <button class="btn btn-ghost btn-sm" @click="editItem = null">取消</button>
            <button class="save-btn" @click="saveEdit" :disabled="saving">保存</button>
          </div>
        </div>
      </div>
    </div>

    <!-- legacy context menu disabled: kept only to avoid touching old mojibake lines -->
    <div v-if="false && ctxMenu.show" class="ctx-menu" :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }" @click.stop>
      <template v-if="ctxMenu.mode === 'blank'">
        <div v-if="!ctxFolderNaming" class="ctx-item" @click="ctxStartCreateFolder">新建文件夹</div>
        <div v-else class="ctx-folder-form">
          <input
            v-model="ctxFolderDraft"
            class="ctx-folder-input"
            placeholder="文件夹名称"
            autofocus
            @keyup.enter="ctxConfirmCreateFolder"
            @keyup.esc="hideCtxMenu" />
          <button class="ctx-mini-btn" @click="ctxConfirmCreateFolder" :disabled="creatingFolder">确定</button>
        </div>
        <div class="ctx-item" @click="triggerUpload()">上传素材</div>
        <div class="ctx-item" @click="hideCtxMenu(); loadList()">刷新列表</div>
      </template>
      <template v-else-if="ctxMenu.mode === 'card' && ctxMenu.item">
        <div class="ctx-item" @click="openPreview(ctxMenu.item); hideCtxMenu()">预览</div>
        <div class="ctx-item" @click="quickRenameMaterial(ctxMenu.item); hideCtxMenu()">重命名</div>
        <div class="ctx-item" @click="openEdit(ctxMenu.item); hideCtxMenu()">编辑信息</div>
        <div class="ctx-item" @click="downloadFile(ctxMenu.item); hideCtxMenu()">下载</div>
        <div class="ctx-sep"></div>
        <div class="ctx-label">修改分类</div>
        <div v-for="c in categories" :key="c.category" class="ctx-item ctx-indent" @click="ctxChangeCategory(ctxMenu.item, c.category)">
          {{ c.category }} ({{ c.cnt }})
        </div>
        <div class="ctx-sep"></div>
        <div class="ctx-item ctx-danger" @click="ctxDelete(ctxMenu.item)">删除</div>
      </template>
    </div>
    <div v-if="ctxMenu.show" class="ctx-menu" :style="{ top: ctxMenu.y + 'px', left: ctxMenu.x + 'px' }" @click.stop>
      <template v-if="ctxMenu.mode === 'blank'">
        <div v-if="!ctxFolderNaming" class="ctx-item" @click="ctxStartCreateFolder">新建文件夹</div>
        <div v-else class="ctx-folder-form">
          <input
            v-model="ctxFolderDraft"
            class="ctx-folder-input"
            placeholder="文件夹名称"
            autofocus
            @keyup.enter="ctxConfirmCreateFolder"
            @keyup.esc="hideCtxMenu" />
          <button class="ctx-mini-btn" @click="ctxConfirmCreateFolder" :disabled="creatingFolder">确定</button>
        </div>
        <div class="ctx-item" @click="triggerUpload()">上传素材</div>
        <div class="ctx-item" @click="hideCtxMenu(); loadList()">刷新列表</div>
      </template>
      <template v-else-if="ctxMenu.mode === 'card' && ctxMenu.item">
        <div class="ctx-item" @click="openPreview(ctxMenu.item); hideCtxMenu()">预览</div>
        <div class="ctx-item" @click="openDetail(ctxMenu.item); hideCtxMenu()">查看详情</div>
        <div class="ctx-item" @click="quickRenameMaterial(ctxMenu.item); hideCtxMenu()">重命名</div>
        <div class="ctx-item" @click="openEdit(ctxMenu.item); hideCtxMenu()">编辑信息</div>
        <div class="ctx-item" @click="downloadFile(ctxMenu.item); hideCtxMenu()">下载</div>
        <div class="ctx-sep"></div>
        <div class="ctx-label">修改分类</div>
        <div v-for="c in categories" :key="c.category" class="ctx-item ctx-indent" @click="ctxChangeCategory(ctxMenu.item, c.category)">
          {{ c.category }} ({{ c.cnt }})
        </div>
        <div class="ctx-sep"></div>
        <div class="ctx-item ctx-danger" @click="ctxDelete(ctxMenu.item)">删除</div>
      </template>
      <template v-else-if="ctxMenu.mode === 'folder' && ctxMenu.item">
        <div class="ctx-item" @click="selectFolder(ctxMenu.item.path); hideCtxMenu()">打开文件夹</div>
        <div v-if="!folderRenameNaming" class="ctx-item" @click="ctxStartRenameFolder">重命名</div>
        <div v-else class="ctx-folder-form">
          <input
            v-model="folderRenameDraft"
            class="ctx-folder-input"
            placeholder="文件夹名称"
            autofocus
            @keyup.enter="ctxConfirmRenameFolder"
            @keyup.esc="hideCtxMenu" />
          <button class="ctx-mini-btn" @click="ctxConfirmRenameFolder">确定</button>
        </div>
        <div v-if="!folderMoveNaming" class="ctx-item" @click="ctxStartMoveFolder">移动到...</div>
        <div v-else class="ctx-folder-form">
          <select v-model="folderMoveTarget" class="ctx-folder-input">
            <option value="/">根目录</option>
            <option
              v-for="folder in folderOptions"
              :key="folder.path"
              :value="folder.path"
              :disabled="folder.path === ctxMenu.item.path || folder.path.startsWith(ctxMenu.item.path + '/')">
              {{ folder.label }}
            </option>
          </select>
          <button class="ctx-mini-btn" @click="ctxConfirmMoveFolder">移动</button>
        </div>
        <div class="ctx-sep"></div>
        <div class="ctx-item ctx-danger" @click="ctxRemoveFolder">删除文件夹</div>
      </template>
    </div>
    <div v-if="ctxMenu.show" class="ctx-backdrop" @click="hideCtxMenu"></div>
  </div>
</template>

<script setup>
import { useMaterialLibrary } from './materials/useMaterialLibrary'

const props = defineProps({
  trafficContext: { type: Object, default: null }
})

const {
  ALL_FOLDER,
  ALL_CATEGORY,
  materialType,
  typeLabels,
  typeExts,
  BGM_TAGS,
  EDIT_USE_TAGS,
  switchType,
  uploadInputRef,
  triggerUpload,
  categories,
  total,
  totalSize,
  storage,
  folderRows,
  visibleFolders,
  rootFolderStats,
  currentFolder,
  currentFolderLabel,
  breadcrumbItems,
  newFolderName,
  folderLoading,
  creatingFolder,
  selectFolder,
  createCurrentFolder,
  removeFolder,
  loading,
  selectedCat,
  searchText,
  page,
  pageSize,
  sortBy,
  sortDir,
  viewMode,
  setViewMode,
  debouncedSearch,
  loadList,
  list,
  dragging,
  uploading,
  uploadPct,
  uploadMsg,
  uploadMsgType,
  uploadCurrentPct,
  uploadCurrentName,
  uploadSpeedText,
  uploadEtaText,
  uploadQueueText,
  onDragEnter,
  onDragOver,
  onDragLeave,
  onDrop,
  onFileSelect,
  deleteItem,
  openEdit,
  quickRenameMaterial,
  quickRenameFolder,
  openPreview,
  previewItem,
  downloadFile,
  editItem,
  editName,
  editCategory,
  editTagsStr,
  saving,
  aiTaggingId,
  saveEdit,
  runAiTag,
  applyQuickSearch,
  toggleUseTagForItem,
  materialUseTags,
  hasUseTag,
  formatDuration,
  formatSize,
  formatDate,
  selectCategory,
  changeSort,
  toggleSortDir,
  nextPage,
  prevPage,
  totalPages,
  selectedCount,
  folderOptions,
  detailItem,
  detailFolder,
  bulkMoving,
  bulkMoveTarget,
  bulkAiTagging,
  projectBinding,
  projectOptions,
  projectTaskOptions,
  bindProjectId,
  bindTaskId,
  projectBindingHint,
  folderMoveNaming,
  folderMoveTarget,
  dragOverFolder,
  undoStack,
  clipBasketItems,
  clipBasketCount,
  basketOpen,
  isSelected,
  toggleSelect,
  selectAllVisible,
  clearSelection,
  openDetail,
  openFolderDetail,
  closeDetail,
              startDragItem,
              startDragFolder,
              clearDragState,
              toggleFolderOpen,
              isFolderOpen,
              hasFolderChildren,
              dragOverFolderPath,
  dropItemToFolder,
  addToClipBasket,
  removeFromClipBasket,
  clearClipBasket,
  toggleBasketOpen,
  runUndo,
  batchDeleteSelected,
  batchMoveSelected,
  batchAiTagSelected,
  changeBindProject,
  batchBindProjectTask,
  ctxMenu,
  ctxFolderNaming,
  ctxFolderDraft,
  folderRenameNaming,
  folderRenameDraft,
  showBlankCtxMenu,
  showCardCtxMenu,
  showFolderCtxMenu,
  hideCtxMenu,
  ctxStartCreateFolder,
  ctxConfirmCreateFolder,
  ctxStartRenameFolder,
  ctxConfirmRenameFolder,
  ctxRemoveFolder,
  ctxStartMoveFolder,
  ctxConfirmMoveFolder,
  ctxDelete,
  ctxChangeCategory
} = useMaterialLibrary(props)

function toggleBgmTag(tag) {
  const tags = editTagsStr.value.split(',').map(t => t.trim()).filter(Boolean)
  const idx = tags.indexOf(tag)
  if (idx >= 0) tags.splice(idx, 1)
  else tags.push(tag)
  editTagsStr.value = tags.join(',')
}

function fileTypeLabel(item) {
  if (item.type === 'bgm') return 'BGM'
  if (item.type === 'image') return 'IMG'
  return 'VID'
}
</script>

<style scoped>
.material-library {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}

.material-library.page-dragover::after {
  content: "松开导入素材";
  position: absolute;
  inset: 10px;
  z-index: 20;
  display: grid;
  place-items: center;
  border: 2px dashed var(--accent);
  border-radius: var(--radius);
  background: rgba(0, 0, 0, 0.28);
  color: #fff;
  font-size: 18px;
  font-weight: 800;
  pointer-events: none;
}

.material-header {
  gap: 14px;
}

.type-tabs {
  display: flex;
  gap: 4px;
  background: var(--surface2);
  padding: 4px;
  border-radius: 10px;
  border: 1px solid var(--border);
}

.type-tab {
  padding: 6px 15px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: var(--text-dim);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}

.type-tab.active {
  background: var(--primary);
  color: #fff;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.stat-pill,
.upload-msg {
  max-width: 320px;
  padding: 6px 12px;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface2);
  color: var(--text-dim);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-msg.success { color: var(--accent); border-color: rgba(0, 245, 212, 0.24); }
.upload-msg.error { color: #fca5a5; border-color: rgba(248, 113, 113, 0.35); }

.nas-layout {
  min-height: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 310px minmax(0, 1fr) auto;
  gap: 16px;
  overflow: hidden;
}

.nas-sidebar,
.nas-main,
.detail-panel {
  min-height: 0;
  overflow: hidden;
}

.nas-sidebar {
  display: grid;
  grid-template-rows: auto minmax(0, 1fr) auto;
  gap: 12px;
}

.upload-zone,
.tree-panel,
.storage-card,
.scan-card,
.nas-toolbar,
.category-strip,
.folder-section,
.content-section {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.upload-zone {
  padding: 16px;
  cursor: pointer;
  text-align: center;
  border-style: dashed;
}

.upload-zone:hover,
.upload-zone.dragover {
  border-color: var(--accent);
  background: rgba(0, 245, 212, 0.05);
}

.upload-icon {
  font-size: 26px;
  color: var(--accent);
}

.upload-title {
  margin-top: 4px;
  color: var(--text);
  font-weight: 700;
}

.upload-sub {
  margin-top: 4px;
  color: var(--text-muted);
  font-size: 11px;
}

.upload-progress {
  margin-top: 12px;
}

.upload-file-row,
.upload-speed-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  color: var(--text-muted);
  font-size: 11px;
}

.upload-file-row {
  margin-bottom: 7px;
}

.upload-file-row span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.upload-file-row strong {
  color: var(--text);
  font-size: 12px;
}

.upload-speed-row {
  margin-top: 7px;
  flex-wrap: wrap;
}

.progress-bar {
  height: 5px;
  background: var(--surface2);
  border-radius: 999px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--primary));
}

.tree-panel {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 14px;
  border-bottom: 1px solid var(--border);
}

.panel-head span,
.storage-card span {
  display: block;
  color: var(--text-muted);
  font-size: 11px;
}

.panel-head strong {
  display: block;
  margin-top: 2px;
  color: var(--text);
  font-size: 14px;
}

.mini-btn {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface2);
  color: var(--text-dim);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  padding: 5px 9px;
}

.tree-list {
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.tree-row {
  width: 100%;
  min-width: 0;
  display: grid;
  grid-template-columns: 18px 18px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 7px;
  padding: 8px 9px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
  font: inherit;
  text-align: left;
}

.tree-row > .tree-icon:first-child {
  grid-column: 1 / 3;
}

.tree-toggle {
  width: 18px;
  height: 18px;
  display: grid;
  place-items: center;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 13px;
  line-height: 1;
}

.tree-toggle:hover {
  background: rgba(255, 255, 255, 0.08);
  color: var(--accent);
}

.tree-toggle-empty {
  opacity: 0;
  pointer-events: none;
}

.tree-row:hover {
  background: var(--surface2);
  color: var(--text);
}

.tree-row.active {
  border-color: rgba(0, 245, 212, 0.24);
  background: rgba(0, 245, 212, 0.08);
  color: var(--accent);
}

.tree-row.dragover,
.folder-card.dragover {
  border-color: rgba(0, 245, 212, 0.65);
  background: rgba(0, 245, 212, 0.12);
}

.tree-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tree-row em {
  color: var(--text-muted);
  font-size: 10px;
  font-style: normal;
}

.tree-delete {
  width: 20px;
  height: 20px;
  border: 1px solid var(--border);
  border-radius: 50%;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
}

.tree-delete:hover {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.45);
}

.tree-hint {
  padding: 10px;
  color: var(--text-muted);
  font-size: 12px;
}

.storage-card {
  padding: 14px;
}

.storage-card strong {
  display: block;
  margin-top: 4px;
  color: var(--text);
  font-size: 22px;
}

.storage-card p,
.storage-card small {
  display: block;
  margin: 6px 0 0;
  color: var(--text-muted);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.nas-main {
  display: flex;
  flex-direction: column;
  gap: 12px;
  overflow-y: auto;
}

.scan-card {
  padding: 12px 14px;
  border-color: rgba(0, 245, 212, 0.22);
  background:
    linear-gradient(135deg, rgba(0, 245, 212, 0.08), rgba(255, 255, 255, 0.03)),
    var(--surface);
}

.scan-card div {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text);
}

.scan-card span,
.scan-card p {
  color: var(--text-muted);
  font-size: 12px;
}

.scan-card p {
  margin: 8px 0 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.scan-import-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.scan-import-card .scan-head,
.scan-import-card .scan-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.scan-import-card .scan-head > div:first-child {
  display: grid;
  gap: 4px;
}

.scan-import-card .scan-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.scan-import-card .scan-note {
  margin: 0;
  white-space: normal;
}

.scan-file-list {
  display: grid;
  gap: 6px;
  max-height: 260px;
  overflow: auto;
}

.scan-file-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) 90px 90px;
  gap: 10px;
  align-items: center;
  padding: 8px 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  color: var(--text-dim);
  font-size: 12px;
}

.scan-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text);
}

.detail-panel {
  width: 300px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface);
}

.nas-toolbar {
  display: grid;
  grid-template-columns: minmax(220px, 1fr) minmax(360px, 1.7fr) auto;
  gap: 10px;
  align-items: center;
  padding: 12px;
}

.breadcrumb,
.toolbar-actions,
.folder-create {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.toolbar-stack {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.breadcrumb button {
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
}

.breadcrumb span {
  margin-left: 8px;
  color: var(--text-muted);
}

.search-inp {
  min-width: 180px;
  flex: 1;
}

.select-inp {
  width: 100px;
}

.folder-input {
  width: 150px;
}

.quick-use-strip {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  overflow-x: auto;
  padding-bottom: 1px;
}

.quick-use-strip > span {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 11px;
}

.btn.active {
  color: var(--accent);
  border-color: rgba(0, 245, 212, 0.35);
}

.category-strip {
  display: flex;
  gap: 8px;
  overflow-x: auto;
  padding: 10px 12px;
}

.cat-chip {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface2);
  color: var(--text-dim);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 6px 11px;
  white-space: nowrap;
}

.cat-chip.active {
  color: var(--accent);
  border-color: rgba(0, 245, 212, 0.3);
  background: rgba(0, 245, 212, 0.08);
}

.folder-section,
.content-section {
  padding: 14px;
}

.section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  color: var(--text);
  font-size: 13px;
  font-weight: 800;
}

.section-title em {
  color: var(--text-muted);
  font-size: 12px;
  font-style: normal;
  font-weight: 500;
}

.bulk-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding: 9px 10px;
  border: 1px solid rgba(0, 245, 212, 0.22);
  border-radius: 10px;
  background: rgba(0, 245, 212, 0.06);
}

.bulk-bar strong {
  color: var(--accent);
  font-size: 12px;
  margin-right: 4px;
}

.context-bar,
.bulk-hint {
  color: var(--text-muted);
  font-size: 12px;
}

.context-bar {
  margin-bottom: 12px;
  padding: 8px 10px;
  border: 1px solid rgba(56, 189, 248, 0.2);
  border-radius: 8px;
  background: rgba(56, 189, 248, 0.06);
}

.bulk-select {
  width: 220px;
  height: 30px;
}

.project-bind-task {
  width: 260px;
}

.folder-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 10px;
}

.folder-card {
  display: grid;
  grid-template-columns: 38px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface2);
  cursor: pointer;
}

.folder-card strong {
  display: block;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-card p {
  margin: 3px 0 0;
  color: var(--text-muted);
  font-size: 11px;
}

.folder-card .folder-full-path {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.folder-card .folder-deep-stat {
  color: var(--text);
  font-weight: 600;
}

.folder-card button {
  border: 0;
  background: transparent;
  color: #f87171;
  cursor: pointer;
}

.folder-card-icon {
  display: grid;
  place-items: center;
  width: 38px;
  height: 34px;
  border-radius: 9px;
  background: rgba(0, 245, 212, 0.08);
  color: var(--accent);
}

.material-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 14px;
}

.explorer-grid {
  align-items: stretch;
}

.explorer-folder-card {
  position: relative;
  display: grid;
  grid-template-rows: 96px minmax(82px, auto) auto;
  gap: 10px;
  min-height: 226px;
  padding: 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface2);
  cursor: pointer;
  outline: none;
}

.explorer-folder-card:hover,
.explorer-folder-card:focus-visible {
  border-color: rgba(0, 245, 212, 0.42);
  box-shadow: 0 0 0 1px rgba(0, 245, 212, 0.08);
}

.explorer-folder-card.dragover,
.folder-table-row.dragover {
  border-color: rgba(0, 245, 212, 0.65);
  background: rgba(0, 245, 212, 0.12);
}

.explorer-folder-icon {
  display: grid;
  place-items: center;
  align-self: stretch;
  border-radius: 9px;
  background:
    linear-gradient(180deg, rgba(251, 191, 36, 0.28), rgba(245, 158, 11, 0.1)),
    rgba(255, 255, 255, 0.04);
  color: #fbbf24;
  font-size: 42px;
}

.explorer-folder-info {
  min-width: 0;
  display: grid;
  gap: 4px;
}

.explorer-folder-info strong,
.explorer-folder-info span,
.explorer-folder-info em {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.explorer-folder-info strong {
  color: var(--text);
  font-size: 14px;
}

.explorer-folder-info span,
.explorer-folder-info em {
  color: var(--text-muted);
  font-size: 11px;
  font-style: normal;
}

.explorer-folder-actions {
  display: flex;
  justify-content: flex-end;
  gap: 6px;
}

.explorer-folder-actions button {
  height: 26px;
  padding: 0 8px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--text-muted);
  cursor: pointer;
}

.explorer-folder-actions button:hover {
  color: var(--text);
}

.folder-table-row {
  cursor: pointer;
}

.folder-name-cell {
  color: var(--text);
  font-weight: 800;
}

.folder-row-icon {
  display: grid;
  place-items: center;
  width: 24px;
  height: 22px;
  border-radius: 6px;
  background: rgba(251, 191, 36, 0.12);
  color: #fbbf24;
}

.material-card {
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface2);
  cursor: pointer;
}

.material-card.selected,
.table-row.selected {
  border-color: rgba(0, 245, 212, 0.45);
  box-shadow: 0 0 0 1px rgba(0, 245, 212, 0.12);
}

.select-check {
  position: absolute;
  top: 9px;
  left: 9px;
  z-index: 3;
  width: 24px;
  height: 24px;
  display: grid;
  place-items: center;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 7px;
  background: rgba(7, 7, 19, 0.72);
  backdrop-filter: blur(8px);
}

.select-check input,
.check-name input {
  accent-color: var(--accent);
}

.material-thumb {
  position: relative;
  height: 145px;
  background: #070713;
  cursor: pointer;
  overflow: hidden;
}

.material-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.thumb-placeholder {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--text-muted);
  font-size: 24px;
}

.play-overlay {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.34);
  color: #fff;
  opacity: 0;
  transition: opacity 0.16s;
}

.material-thumb:hover .play-overlay {
  opacity: 1;
}

.material-duration {
  position: absolute;
  right: 8px;
  bottom: 8px;
  padding: 2px 7px;
  border-radius: 5px;
  background: rgba(0, 0, 0, 0.72);
  color: #fff;
  font-size: 11px;
}

.material-info {
  display: flex;
  flex-direction: column;
  gap: 7px;
  padding: 11px;
}

.material-name,
.material-path {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.material-name {
  color: var(--text);
  font-size: 13px;
  font-weight: 700;
}

.material-path,
.material-meta {
  color: var(--text-muted);
  font-size: 11px;
}

.material-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cat-badge {
  padding: 3px 8px;
  border: 1px solid rgba(0, 245, 212, 0.2);
  border-radius: 999px;
  color: var(--accent);
  background: rgba(0, 245, 212, 0.08);
}

.material-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  max-height: 44px;
  overflow: hidden;
}

.tag-chip {
  padding: 2px 7px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-dim);
  font-size: 10px;
}

.use-row {
  display: flex;
  align-items: center;
  gap: 5px;
  min-height: 24px;
  overflow: hidden;
}

.use-label {
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: 11px;
}

.use-chip {
  flex: 0 0 auto;
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface2);
  color: var(--text-dim);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  line-height: 1;
  padding: 6px 9px;
  white-space: nowrap;
}

.use-chip:hover {
  border-color: var(--border-mid);
  color: var(--text);
}

.use-chip.active {
  border-color: rgba(16, 185, 129, 0.42);
  background: rgba(16, 185, 129, 0.12);
  color: #6ee7b7;
}

.use-empty {
  color: var(--text-muted);
  font-size: 11px;
}

.material-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 2px;
}

.danger {
  color: #f87171;
}

.material-table {
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 10px;
}

.table-row {
  display: grid;
  grid-template-columns: minmax(220px, 1.3fr) minmax(130px, 0.9fr) 90px minmax(160px, 1fr) 110px 80px 92px 150px;
  gap: 10px;
  align-items: center;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border);
  color: var(--text-dim);
  font-size: 12px;
  cursor: pointer;
}

.table-row:last-child {
  border-bottom: 0;
}

.table-row:hover {
  background: var(--surface2);
}

.table-head {
  color: var(--text-muted);
  font-weight: 800;
  background: rgba(255, 255, 255, 0.02);
}

.file-name,
.tag-cell,
.path-cell,
.owner-cell,
.project-cell {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-cell {
  display: grid;
  gap: 2px;
}

.tag-cell em,
.tag-cell small {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tag-cell small {
  color: var(--text-muted);
  font-size: 10px;
}

.check-name {
  display: flex;
  align-items: center;
  gap: 8px;
}

.check-name span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.table-actions {
  display: flex;
  gap: 6px;
}

.table-actions button {
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
}

.list-empty {
  padding: 70px 20px;
  text-align: center;
}

.empty-icon {
  color: var(--text-muted);
  font-size: 38px;
}

.empty-text {
  margin-top: 8px;
  color: var(--text);
  font-size: 16px;
  font-weight: 800;
}

.empty-sub {
  margin-top: 5px;
  color: var(--text-muted);
  font-size: 13px;
}

.pager-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 14px;
}

.pager-info {
  color: var(--text-muted);
  font-size: 12px;
}

.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: var(--text);
  font-weight: 800;
}

.detail-head button {
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface2);
  color: var(--text-muted);
  cursor: pointer;
  font: inherit;
  font-size: 11px;
  padding: 5px 9px;
}

.detail-preview {
  height: 170px;
  display: grid;
  place-items: center;
  overflow: hidden;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: #070713;
  color: var(--text-muted);
  cursor: pointer;
}

.detail-folder-icon {
  height: 132px;
  display: grid;
  place-items: center;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: rgba(0, 245, 212, 0.08);
  color: var(--accent);
  font-size: 48px;
}

.detail-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.detail-panel h3 {
  margin: 0;
  color: var(--text);
  font-size: 15px;
  line-height: 1.35;
  word-break: break-all;
}

.detail-path {
  margin: -6px 0 0;
  color: var(--text-muted);
  font-size: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-meta {
  display: grid;
  grid-template-columns: 58px minmax(0, 1fr);
  gap: 8px 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface2);
  font-size: 12px;
}

.detail-meta span {
  color: var(--text-muted);
}

.detail-meta strong {
  min-width: 0;
  color: var(--text-dim);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.detail-tags span {
  padding: 3px 8px;
  border: 1px solid var(--border);
  border-radius: 999px;
  color: var(--text-dim);
  font-size: 11px;
}

.detail-use-panel {
  display: grid;
  gap: 10px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface2);
}

.detail-section-head {
  display: grid;
  gap: 3px;
}

.detail-section-head strong {
  color: var(--text);
  font-size: 12px;
}

.detail-section-head span {
  color: var(--text-muted);
  font-size: 11px;
  line-height: 1.45;
}

.detail-use-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.detail-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.basket-panel {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: 900;
  width: 340px;
  max-height: 56vh;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--border-mid);
  border-radius: 14px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
  overflow: hidden;
}

.basket-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 14px;
  border-bottom: 1px solid var(--border);
  color: var(--text);
}

.basket-head button,
.basket-item button {
  border: 0;
  background: transparent;
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
}

.basket-empty {
  padding: 28px 14px;
  color: var(--text-muted);
  text-align: center;
  font-size: 12px;
}

.basket-list {
  overflow-y: auto;
  padding: 8px;
}

.basket-item {
  display: grid;
  grid-template-columns: 42px minmax(0, 1fr) auto;
  align-items: center;
  gap: 9px;
  padding: 8px;
  border-radius: 9px;
  color: var(--text-dim);
  font-size: 12px;
}

.basket-item:hover {
  background: var(--surface2);
}

.basket-item img {
  width: 42px;
  height: 30px;
  border-radius: 6px;
  object-fit: cover;
  background: #050510;
}

.basket-item span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skeleton-card {
  height: 220px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--surface2);
  padding: 12px;
}

.skeleton {
  border-radius: 8px;
  background: linear-gradient(90deg, rgba(255,255,255,.04), rgba(255,255,255,.1), rgba(255,255,255,.04));
  background-size: 200% 100%;
  animation: shimmer 1.2s infinite;
}

.skeleton-thumb {
  height: 130px;
}

.skeleton-line {
  height: 12px;
  margin-top: 14px;
}

.skeleton-line.short {
  width: 60%;
}

.preview-modal {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.78);
  backdrop-filter: blur(4px);
}

.preview-box {
  width: 900px;
  max-width: 95vw;
  overflow: hidden;
  border: 1px solid var(--border-mid);
  border-radius: var(--radius);
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}

.edit-box {
  width: 480px;
}

.preview-hdr {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--border);
}

.preview-title {
  color: var(--text);
  font-weight: 700;
}

.preview-close {
  border: 0;
  background: transparent;
  color: var(--text-dim);
  cursor: pointer;
}

.preview-media {
  background: #000;
  text-align: center;
}

.preview-media video,
.preview-media img {
  width: 100%;
  max-height: 70vh;
  object-fit: contain;
}

.preview-media.image {
  padding: 20px;
}

.preview-audio {
  padding: 28px;
  text-align: center;
}

.audio-icon {
  margin-bottom: 14px;
  color: var(--text-muted);
  font-size: 32px;
}

.preview-audio audio {
  width: 100%;
}

.edit-form {
  display: flex;
  flex-direction: column;
  gap: 15px;
  padding: 20px 24px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 7px;
  color: var(--text-dim);
  font-size: 12px;
}

.bgm-tag-presets {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}

.bgm-tag-btn {
  border: 1px solid var(--border);
  border-radius: 999px;
  background: var(--surface2);
  color: var(--text-dim);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 5px 10px;
}

.bgm-tag-btn.active {
  color: var(--accent);
  border-color: rgba(0, 245, 212, 0.35);
}

.edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.save-btn {
  border: 0;
  border-radius: 8px;
  background: var(--primary);
  color: #fff;
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 7px 16px;
}

.ctx-menu {
  position: fixed;
  z-index: 1200;
  min-width: 185px;
  padding: 6px;
  border: 1px solid var(--border-mid);
  border-radius: 10px;
  background: var(--surface);
  box-shadow: var(--shadow-lg);
}

.ctx-item {
  padding: 8px 10px;
  border-radius: 7px;
  color: var(--text-dim);
  cursor: pointer;
  font-size: 12px;
}

.ctx-item:hover {
  background: var(--surface2);
  color: var(--text);
}

.ctx-folder-form {
  display: grid;
  grid-template-columns: minmax(130px, 1fr) auto;
  gap: 6px;
  padding: 6px;
}

.ctx-folder-input {
  min-width: 0;
  height: 30px;
  border: 1px solid var(--border);
  border-radius: 7px;
  background: var(--surface2);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  outline: none;
  padding: 0 8px;
}

.ctx-folder-input:focus {
  border-color: rgba(0, 245, 212, 0.5);
  box-shadow: 0 0 0 2px rgba(0, 245, 212, 0.08);
}

.ctx-mini-btn {
  height: 30px;
  border: 1px solid rgba(0, 245, 212, 0.32);
  border-radius: 7px;
  background: rgba(0, 245, 212, 0.08);
  color: var(--accent);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 0 10px;
}

.ctx-mini-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.ctx-danger {
  color: #f87171;
}

.ctx-indent {
  padding-left: 18px;
}

.ctx-label {
  padding: 7px 10px 4px;
  color: var(--text-muted);
  font-size: 10px;
}

.ctx-sep {
  height: 1px;
  margin: 4px 0;
  background: var(--border);
}

.ctx-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1199;
}

/* readability pass */
.material-library .nas-sidebar,
.material-library .nas-main,
.material-library .detail-panel,
.material-library .tool-panel,
.material-library .material-table {
  border-color: var(--card-border, var(--border));
  background: var(--card-bg, var(--panel-bg));
  box-shadow: var(--shadow);
}

.material-library .material-card {
  border-color: var(--card-border, var(--border));
  background: var(--card-bg, var(--panel-bg));
  box-shadow: 0 1px 0 rgba(255, 255, 255, 0.035);
}

.material-library .material-card:hover,
.material-library .table-row:hover {
  border-color: var(--card-border-hover, var(--border-mid));
  background: var(--row-bg-hover, var(--panel-bg-hover));
}

.material-card.selected,
.table-row.selected {
  border-color: var(--border-bright);
  box-shadow: 0 0 0 1px var(--focus-ring);
}

.material-thumb {
  background: var(--page-bg, var(--bg-card));
}

.cat-badge,
.tag-chip,
.use-chip,
.material-library .folder-chip,
.material-library .filter-chip {
  border-color: var(--chip-border);
  background: var(--row-bg, var(--chip-bg));
}

.use-chip.active {
  border-color: rgba(16, 185, 129, 0.46);
  background: rgba(16, 185, 129, 0.13);
  color: #34d399;
}

.material-table {
  background: var(--card-bg, var(--panel-bg));
}

.table-row {
  border-bottom-color: var(--divider, var(--border));
}

.table-head {
  background: var(--card-header-bg, var(--panel-bg-soft));
  color: var(--text-dim);
}

.ctx-menu,
.ctx-folder-input {
  border-color: var(--card-border, var(--border));
  background: var(--card-bg, var(--surface));
}

.ctx-item:hover {
  background: var(--row-bg-hover, var(--surface2));
}

.ctx-mini-btn {
  border-color: var(--border-bright);
  background: var(--accent-soft);
  color: var(--primary-light);
}

@keyframes shimmer {
  to { background-position: -200% 0; }
}

@media (max-width: 1100px) {
  .nas-layout {
    grid-template-columns: 1fr;
  }

  .nas-sidebar {
    grid-template-rows: auto auto auto;
    overflow: visible;
  }

  .tree-panel {
    max-height: 260px;
  }

  .nas-toolbar {
    grid-template-columns: 1fr;
  }

  .toolbar-actions,
  .folder-create {
    flex-wrap: wrap;
  }

  .detail-panel {
    width: auto;
    overflow: visible;
  }
}
</style>
