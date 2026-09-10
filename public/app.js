// ==========================================
// TERMUX DIRECTORIES APP - CLIENT LOGIC
// ==========================================

let ws = null;
let currentPath = '';
let parentPath = null;
let currentItems = [];
let currentViewMode = 'tree'; // 'tree' | 'list'
let showHiddenFiles = localStorage.getItem('termux_dirs_show_hidden') === 'true';
const pendingRequests = new Map();

// Cores personalizáveis salvas
const DEFAULT_COLORS = {
    dirs: '#facc15',
    files: '#9ca3af'
};

let userColors = {
    dirs: localStorage.getItem('termux_color_dirs') || DEFAULT_COLORS.dirs,
    files: localStorage.getItem('termux_color_files') || DEFAULT_COLORS.files
};

// Elementos do DOM
const connectionStatus = document.getElementById('connection-status');
const statsSummary = document.getElementById('stats-summary');
const currentPathText = document.getElementById('current-path-text');
const breadcrumbsBar = document.getElementById('breadcrumbs-bar');
const searchInput = document.getElementById('search-input');
const btnClearSearch = document.getElementById('btn-clear-search');
const btnNavUp = document.getElementById('btn-nav-up');
const btnNavHome = document.getElementById('btn-nav-home');
const btnRefresh = document.getElementById('btn-refresh');
const refreshIcon = document.getElementById('refresh-icon');
const btnViewTree = document.getElementById('btn-view-tree');
const btnViewList = document.getElementById('btn-view-list');
const treeContainer = document.getElementById('tree-container');
const listContainer = document.getElementById('list-container');
const emptyState = document.getElementById('empty-state');
const hiddenIndicator = document.getElementById('hidden-indicator');
const btnToggleHiddenFooter = document.getElementById('btn-toggle-hidden-footer');

// Modais
const fileViewerModal = document.getElementById('file-viewer-modal');
const fileModalTitle = document.getElementById('file-modal-title');
const fileModalMeta = document.getElementById('file-modal-meta');
const fileModalContent = document.getElementById('file-modal-content');
const btnCloseFileModal = document.getElementById('btn-close-file-modal');
const btnFileCopy = document.getElementById('btn-file-copy');
const copyBtnText = document.getElementById('copy-btn-text');
const btnFileSave = document.getElementById('btn-file-save');

const newItemModal = document.getElementById('new-item-modal');
const btnNewItem = document.getElementById('btn-new-item');
const tabCreateFolder = document.getElementById('tab-create-folder');
const tabCreateFile = document.getElementById('tab-create-file');
const newItemName = document.getElementById('new-item-name');
const btnCancelNewItem = document.getElementById('btn-cancel-new-item');
const btnConfirmNewItem = document.getElementById('btn-confirm-new-item');
let newItemType = 'folder';

const settingsModal = document.getElementById('settings-modal');
const btnSettings = document.getElementById('btn-settings');
const btnCloseSettings = document.getElementById('btn-close-settings');
const btnDoneSettings = document.getElementById('btn-done-settings');
const btnResetColors = document.getElementById('btn-reset-colors');
const toggleShowHidden = document.getElementById('toggle-show-hidden');
const swatchesDirs = document.getElementById('swatches-dirs');
const swatchesFiles = document.getElementById('swatches-files');

let currentOpenedFile = null;

// ==========================================
// UTILITÁRIOS
// ==========================================
function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function applyCustomColors() {
    document.documentElement.style.setProperty('--color-dir-item', userColors.dirs);
    document.documentElement.style.setProperty('--color-file-item', userColors.files);

    if (swatchesDirs) {
        swatchesDirs.querySelectorAll('.color-swatch-btn').forEach(btn => {
            const c = (btn.getAttribute('data-color') || '').toLowerCase();
            btn.classList.toggle('active', !!c && c === (userColors.dirs || '').toLowerCase());
        });
    }
    if (swatchesFiles) {
        swatchesFiles.querySelectorAll('.color-swatch-btn').forEach(btn => {
            const c = (btn.getAttribute('data-color') || '').toLowerCase();
            btn.classList.toggle('active', !!c && c === (userColors.files || '').toLowerCase());
        });
    }
}

function updateHiddenStatusUI() {
    if (toggleShowHidden) toggleShowHidden.checked = showHiddenFiles;
    if (hiddenIndicator) {
        hiddenIndicator.className = showHiddenFiles
            ? 'w-1.5 h-1.5 rounded-full bg-amber-400'
            : 'w-1.5 h-1.5 rounded-full bg-slate-600';
    }
}

// ==========================================
// WEBSOCKET & COMUNICAÇÃO
// ==========================================
function initWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}`;
    
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        if (connectionStatus) {
            connectionStatus.className = 'w-2 h-2 rounded-full bg-emerald-500 animate-pulse';
            connectionStatus.title = 'Conectado em tempo real';
        }
        navigateTo(currentPath || '~');
    };

    ws.onclose = () => {
        if (connectionStatus) {
            connectionStatus.className = 'w-2 h-2 rounded-full bg-rose-500';
            connectionStatus.title = 'Reconectando...';
        }
        setTimeout(initWebSocket, 2000);
    };

    ws.onerror = () => {
        if (connectionStatus) {
            connectionStatus.className = 'w-2 h-2 rounded-full bg-amber-500';
        }
    };

    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            
            // Resposta de requisição pendente por requestId
            if (msg.requestId && pendingRequests.has(msg.requestId)) {
                const callback = pendingRequests.get(msg.requestId);
                pendingRequests.delete(msg.requestId);
                callback(msg);
                return;
            }

            // Listagem de diretório
            if (msg.type === 'dir_list_result') {
                handleDirListResponse(msg);
            }
        } catch (e) {
            console.error('[WS Message Error]', e);
        }
    };
}

function sendWsRequest(action, payload = {}) {
    return new Promise((resolve, reject) => {
        const requestId = 'req_' + Math.random().toString(36).substring(2, 9);
        const requestData = { action, requestId, ...payload };

        if (ws && ws.readyState === WebSocket.OPEN) {
            pendingRequests.set(requestId, resolve);
            ws.send(JSON.stringify(requestData));
        } else {
            // Fallback para REST API
            const query = new URLSearchParams(payload).toString();
            fetch(`/api/${action === 'list_dir' ? 'list' : action}?${query}`)
                .then(r => r.json())
                .then(resolve)
                .catch(reject);
        }
    });
}

// ==========================================
// NAVEGAÇÃO E BREADCRUMBS
// ==========================================
async function navigateTo(targetPath) {
    if (refreshIcon) refreshIcon.classList.add('animate-spin');
    if (statsSummary) statsSummary.textContent = 'Carregando itens...';

    try {
        const res = await sendWsRequest('list_dir', {
            path: targetPath,
            showHidden: showHiddenFiles
        });
        handleDirListResponse(res);
    } catch (err) {
        if (statsSummary) statsSummary.textContent = 'Erro ao carregar diretório';
    } finally {
        if (refreshIcon) {
            setTimeout(() => refreshIcon.classList.remove('animate-spin'), 300);
        }
    }
}

function handleDirListResponse(data) {
    if (data.error) {
        if (statsSummary) statsSummary.textContent = `Erro: ${data.error}`;
        return;
    }

    currentPath = data.path;
    parentPath = data.parentPath;
    currentItems = data.items || [];

    if (currentPathText) currentPathText.textContent = currentPath;
    if (btnNavUp) {
        btnNavUp.disabled = !parentPath;
        btnNavUp.classList.toggle('opacity-30', !parentPath);
        btnNavUp.classList.toggle('cursor-not-allowed', !parentPath);
    }

    if (statsSummary) {
        statsSummary.textContent = `${data.dirCount || 0} pastas, ${data.fileCount || 0} arquivos (${data.totalCount || 0} itens)`;
    }

    renderBreadcrumbs(currentPath);
    renderCurrentView();
}

function renderBreadcrumbs(fullPath) {
    if (!breadcrumbsBar) return;
    breadcrumbsBar.innerHTML = '';

    if (!fullPath) return;

    const segments = fullPath.split('/').filter(Boolean);

    // Root Segment
    const rootBtn = document.createElement('button');
    rootBtn.type = 'button';
    rootBtn.className = 'px-1.5 py-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-amber-400 font-bold transition-colors';
    rootBtn.textContent = '/';
    rootBtn.addEventListener('click', () => navigateTo('/'));
    breadcrumbsBar.appendChild(rootBtn);

    let accumulated = '';
    segments.forEach((seg, idx) => {
        accumulated += '/' + seg;
        const thisPath = accumulated;

        const separator = document.createElement('span');
        separator.className = 'text-slate-600 select-none';
        separator.textContent = '›';
        breadcrumbsBar.appendChild(separator);

        const btn = document.createElement('button');
        btn.type = 'button';
        const isLast = idx === segments.length - 1;
        btn.className = `px-1.5 py-0.5 rounded truncate max-w-[140px] transition-colors ${
            isLast ? 'text-amber-400 font-semibold bg-amber-500/10' : 'text-slate-300 hover:bg-slate-800 hover:text-slate-100'
        }`;
        btn.textContent = seg;
        btn.addEventListener('click', () => navigateTo(thisPath));
        breadcrumbsBar.appendChild(btn);
    });

    // Auto-scroll breadcrumbs para a direita
    breadcrumbsBar.scrollLeft = breadcrumbsBar.scrollWidth;
}

// ==========================================
// RENDERIZAÇÃO DAS VIEWS (ÁRVORE / LISTA)
// ==========================================
function renderCurrentView() {
    const filterTerm = (searchInput ? searchInput.value : '').toLowerCase().trim();
    const filteredItems = currentItems.filter(item => {
        if (!filterTerm) return true;
        return item.name.toLowerCase().includes(filterTerm);
    });

    if (filteredItems.length === 0) {
        if (emptyState) emptyState.classList.remove('hidden');
        if (treeContainer) treeContainer.innerHTML = '';
        if (listContainer) listContainer.innerHTML = '';
        return;
    }

    if (emptyState) emptyState.classList.add('hidden');

    if (currentViewMode === 'tree') {
        if (treeContainer) treeContainer.classList.remove('hidden');
        if (listContainer) listContainer.classList.add('hidden');
        renderTreeView(filteredItems);
    } else {
        if (treeContainer) treeContainer.classList.add('hidden');
        if (listContainer) listContainer.classList.remove('hidden');
        renderListView(filteredItems);
    }
}

// Renderização em Árvore
function renderTreeView(items) {
    if (!treeContainer) return;
    treeContainer.innerHTML = '';

    items.forEach(item => {
        const node = createTreeNode(item, currentPath, 0);
        treeContainer.appendChild(node);
    });
}

function createTreeNode(item, basePath, level = 0) {
    const itemPath = (basePath === '/' || basePath === '') ? `/${item.name}` : `${basePath}/${item.name}`;
    const row = document.createElement('div');
    row.className = 'tree-node flex flex-col';

    const itemHeader = document.createElement('div');
    itemHeader.className = 'flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-slate-800/80 cursor-pointer transition-colors group text-xs select-none';
    itemHeader.style.paddingLeft = `${Math.max(6, level * 16 + 6)}px`;

    if (item.isDirectory) {
        itemHeader.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <button type="button" class="tree-chevron text-slate-400 hover:text-white hover:bg-slate-700/60 p-1 -ml-1 rounded transition-colors flex items-center justify-center shrink-0 w-6 h-6" title="Expandir / Recolher">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path>
                    </svg>
                </button>
                <svg class="tree-dir-icon w-4 h-4 fill-none stroke-current shrink-0" viewBox="0 0 24 24" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                </svg>
                <span class="tree-dir-name tree-folder-title font-semibold truncate hover:opacity-80 transition-opacity">${escapeHtml(item.name)}</span>
            </div>
            <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button type="button" class="btn-delete-node text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-700/60" title="Excluir">
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                    </svg>
                </button>
            </div>
        `;

        const subContainer = document.createElement('div');
        subContainer.className = 'hidden flex flex-col';

        const chevron = itemHeader.querySelector('.tree-chevron');
        chevron.addEventListener('click', async (e) => {
            e.stopPropagation();
            if (subContainer.classList.contains('hidden')) {
                subContainer.classList.remove('hidden');
                chevron.classList.add('expanded');
                loadSubtree(itemPath, subContainer, level + 1);
            } else {
                subContainer.classList.add('hidden');
                chevron.classList.remove('expanded');
            }
        });

        // Clique no corpo da pasta: navega para ela
        itemHeader.addEventListener('click', () => {
            navigateTo(itemPath);
        });

        // Ação de excluir
        const btnDelete = itemHeader.querySelector('.btn-delete-node');
        if (btnDelete) {
            btnDelete.addEventListener('click', (e) => {
                e.stopPropagation();
                confirmDeleteItem(itemPath, item.name, true);
            });
        }

        row.appendChild(itemHeader);
        row.appendChild(subContainer);
    } else {
        // Arquivo
        itemHeader.innerHTML = `
            <div class="flex items-center gap-2 min-w-0 flex-1">
                <span class="w-6 shrink-0"></span>
                <svg class="tree-file-icon w-4 h-4 fill-none stroke-current shrink-0" viewBox="0 0 24 24" stroke-width="1.8">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                </svg>
                <span class="tree-file-name font-mono truncate">${escapeHtml(item.name)}</span>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-[10px] text-slate-500 font-mono">${item.formattedSize || ''}</span>
                <div class="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" class="btn-delete-node text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-700/60" title="Excluir">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        // Clique no arquivo: abre visualizador/editor
        itemHeader.addEventListener('click', () => {
            openFileModal(itemPath, item.name);
        });

        // Ação de excluir
        const btnDelete = itemHeader.querySelector('.btn-delete-node');
        if (btnDelete) {
            btnDelete.addEventListener('click', (e) => {
                e.stopPropagation();
                confirmDeleteItem(itemPath, item.name, false);
            });
        }

        row.appendChild(itemHeader);
    }

    return row;
}

async function loadSubtree(targetPath, container, level) {
    container.innerHTML = `
        <div class="flex items-center gap-1.5 py-1 text-slate-500 text-[11px] animate-pulse" style="padding-left: ${level * 16 + 6}px">
            <span class="inline-block w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
            <span>Carregando...</span>
        </div>
    `;

    try {
        const res = await sendWsRequest('list_dir', {
            path: targetPath,
            showHidden: showHiddenFiles
        });

        container.innerHTML = '';
        const items = res.items || [];

        if (items.length === 0) {
            container.innerHTML = `
                <div class="text-slate-500 text-[11px] py-1 italic" style="padding-left: ${level * 16 + 6}px">
                    (pasta vazia)
                </div>
            `;
            return;
        }

        items.forEach(child => {
            const childNode = createTreeNode(child, targetPath, level);
            container.appendChild(childNode);
        });
    } catch (e) {
        container.innerHTML = `
            <div class="text-rose-400 text-[11px] py-1" style="padding-left: ${level * 16 + 6}px">
                Erro ao listar pasta
            </div>
        `;
    }
}

// Renderização Detalhada / Lista
function renderListView(items) {
    if (!listContainer) return;
    listContainer.innerHTML = '';

    items.forEach(item => {
        const itemPath = (currentPath === '/' || currentPath === '') ? `/${item.name}` : `${currentPath}/${item.name}`;
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between p-2 rounded-lg bg-slate-900/40 hover:bg-slate-850 border border-slate-800/60 hover:border-slate-700 transition-all cursor-pointer group text-xs';

        if (item.isDirectory) {
            row.innerHTML = `
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <svg class="tree-dir-icon w-5 h-5 fill-none stroke-current shrink-0" viewBox="0 0 24 24" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"></path>
                    </svg>
                    <div class="min-w-0">
                        <span class="tree-dir-name font-semibold block truncate">${escapeHtml(item.name)}</span>
                        <span class="text-[10px] text-slate-500 font-mono">Diretório</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" class="btn-delete-node text-slate-500 hover:text-rose-400 p-1.5 rounded hover:bg-slate-700/60 opacity-0 group-hover:opacity-100 transition-opacity" title="Excluir">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                    <svg class="w-4 h-4 text-slate-600" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"></path>
                    </svg>
                </div>
            `;

            row.addEventListener('click', () => navigateTo(itemPath));
        } else {
            row.innerHTML = `
                <div class="flex items-center gap-2.5 min-w-0 flex-1">
                    <svg class="tree-file-icon w-5 h-5 fill-none stroke-current shrink-0" viewBox="0 0 24 24" stroke-width="1.8">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z"></path>
                    </svg>
                    <div class="min-w-0">
                        <span class="tree-file-name font-mono block truncate">${escapeHtml(item.name)}</span>
                        <span class="text-[10px] text-slate-500 font-mono">${item.formattedSize || '0 B'}</span>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    <button type="button" class="btn-delete-node text-slate-500 hover:text-rose-400 p-1.5 rounded hover:bg-slate-700/60 opacity-0 group-hover:opacity-100 transition-opacity" title="Excluir">
                        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path>
                        </svg>
                    </button>
                </div>
            `;

            row.addEventListener('click', () => openFileModal(itemPath, item.name));
        }

        const btnDelete = row.querySelector('.btn-delete-node');
        if (btnDelete) {
            btnDelete.addEventListener('click', (e) => {
                e.stopPropagation();
                confirmDeleteItem(itemPath, item.name, item.isDirectory);
            });
        }

        listContainer.appendChild(row);
    });
}

// ==========================================
// VISUALIZAÇÃO / EDIÇÃO DE ARQUIVOS
// ==========================================
async function openFileModal(filePath, fileName) {
    currentOpenedFile = filePath;
    if (fileModalTitle) fileModalTitle.textContent = fileName;
    if (fileModalMeta) fileModalMeta.textContent = 'Carregando conteúdo...';
    if (fileModalContent) {
        fileModalContent.value = '';
        fileModalContent.disabled = true;
    }
    if (copyBtnText) copyBtnText.textContent = 'Copiar';

    if (fileViewerModal) fileViewerModal.classList.add('open');

    try {
        const res = await sendWsRequest('read_file', { path: filePath });
        if (res.error) {
            if (fileModalContent) fileModalContent.value = `[Erro ao ler arquivo: ${res.error}]`;
            if (fileModalMeta) fileModalMeta.textContent = 'Falha na leitura';
        } else {
            if (fileModalContent) {
                fileModalContent.value = res.content || '';
                fileModalContent.disabled = false;
            }
            if (fileModalMeta) {
                fileModalMeta.textContent = `${res.formattedSize} • ${filePath}`;
            }
        }
    } catch (e) {
        if (fileModalContent) fileModalContent.value = `[Falha de conexão ao ler arquivo]`;
    }
}

function closeFileModal() {
    if (fileViewerModal) fileViewerModal.classList.remove('open');
    currentOpenedFile = null;
}

if (btnCloseFileModal) btnCloseFileModal.addEventListener('click', closeFileModal);

if (btnFileCopy) {
    btnFileCopy.addEventListener('click', () => {
        if (!fileModalContent) return;
        navigator.clipboard.writeText(fileModalContent.value).then(() => {
            if (copyBtnText) copyBtnText.textContent = 'Copiado!';
            setTimeout(() => {
                if (copyBtnText) copyBtnText.textContent = 'Copiar';
            }, 2000);
        });
    });
}

if (btnFileSave) {
    btnFileSave.addEventListener('click', async () => {
        if (!currentOpenedFile || !fileModalContent) return;
        const newContent = fileModalContent.value;
        btnFileSave.disabled = true;
        btnFileSave.classList.add('opacity-50');

        try {
            const res = await sendWsRequest('save_file', {
                path: currentOpenedFile,
                content: newContent
            });
            if (res.success) {
                alert('Arquivo salvo com sucesso!');
            } else {
                alert(`Erro ao salvar: ${res.error}`);
            }
        } catch (e) {
            alert('Falha ao comunicar com o servidor');
        } finally {
            btnFileSave.disabled = false;
            btnFileSave.classList.remove('opacity-50');
        }
    });
}

// ==========================================
// CRIAR NOVO ITEM (PASTA OU ARQUIVO)
// ==========================================
function openNewItemModal() {
    if (newItemModal) newItemModal.classList.add('open');
    if (newItemName) {
        newItemName.value = '';
        newItemName.focus();
    }
    setNewItemType('folder');
}

function closeNewItemModal() {
    if (newItemModal) newItemModal.classList.remove('open');
}

function setNewItemType(type) {
    newItemType = type;
    if (tabCreateFolder && tabCreateFile) {
        if (type === 'folder') {
            tabCreateFolder.className = 'flex-1 py-1.5 rounded-md text-xs font-medium bg-slate-800 text-amber-400 transition-colors';
            tabCreateFile.className = 'flex-1 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors';
            if (newItemName) newItemName.placeholder = 'ex: minha_pasta';
        } else {
            tabCreateFolder.className = 'flex-1 py-1.5 rounded-md text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors';
            tabCreateFile.className = 'flex-1 py-1.5 rounded-md text-xs font-medium bg-slate-800 text-amber-400 transition-colors';
            if (newItemName) newItemName.placeholder = 'ex: script.js ou notas.txt';
        }
    }
}

if (btnNewItem) btnNewItem.addEventListener('click', openNewItemModal);
if (btnCancelNewItem) btnCancelNewItem.addEventListener('click', closeNewItemModal);
if (tabCreateFolder) tabCreateFolder.addEventListener('click', () => setNewItemType('folder'));
if (tabCreateFile) tabCreateFile.addEventListener('click', () => setNewItemType('file'));

if (btnConfirmNewItem) {
    btnConfirmNewItem.addEventListener('click', async () => {
        const name = (newItemName ? newItemName.value : '').trim();
        if (!name) return alert('Por favor digite um nome.');

        const targetPath = (currentPath === '/' || currentPath === '') ? `/${name}` : `${currentPath}/${name}`;
        const action = newItemType === 'folder' ? 'mkdir' : 'create_file';

        try {
            const res = await sendWsRequest(action, { path: targetPath });
            if (res.success) {
                closeNewItemModal();
                navigateTo(currentPath);
            } else {
                alert(`Erro: ${res.error}`);
            }
        } catch (e) {
            alert('Falha ao criar item');
        }
    });
}

// ==========================================
// EXCLUSÃO DE ITENS
// ==========================================
async function confirmDeleteItem(itemPath, itemName, isDir) {
    const typeLabel = isDir ? 'a pasta' : 'o arquivo';
    const ok = confirm(`Deseja realmente excluir ${typeLabel} "${itemName}"?`);
    if (!ok) return;

    try {
        const res = await sendWsRequest('delete_item', { path: itemPath });
        if (res.success) {
            navigateTo(currentPath);
        } else {
            alert(`Erro ao excluir: ${res.error}`);
        }
    } catch (e) {
        alert('Falha ao excluir item');
    }
}

// ==========================================
// MODAL DE CONFIGURAÇÕES E CORES
// ==========================================
function openSettings() {
    if (settingsModal) settingsModal.classList.add('open');
    updateHiddenStatusUI();
}

function closeSettings() {
    if (settingsModal) settingsModal.classList.remove('open');
}

if (btnSettings) btnSettings.addEventListener('click', openSettings);
if (btnCloseSettings) btnCloseSettings.addEventListener('click', closeSettings);
if (btnDoneSettings) btnDoneSettings.addEventListener('click', closeSettings);

// Listeners de swatches de cores
if (swatchesDirs) {
    swatchesDirs.querySelectorAll('.color-swatch-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.getAttribute('data-color');
            userColors.dirs = color;
            localStorage.setItem('termux_color_dirs', color);
            applyCustomColors();
        });
    });
}

if (swatchesFiles) {
    swatchesFiles.querySelectorAll('.color-swatch-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.getAttribute('data-color');
            userColors.files = color;
            localStorage.setItem('termux_color_files', color);
            applyCustomColors();
        });
    });
}

if (btnResetColors) {
    btnResetColors.addEventListener('click', () => {
        userColors = { ...DEFAULT_COLORS };
        localStorage.removeItem('termux_color_dirs');
        localStorage.removeItem('termux_color_files');
        applyCustomColors();
    });
}

if (toggleShowHidden) {
    toggleShowHidden.addEventListener('change', (e) => {
        showHiddenFiles = e.target.checked;
        localStorage.setItem('termux_dirs_show_hidden', showHiddenFiles ? 'true' : 'false');
        updateHiddenStatusUI();
        navigateTo(currentPath);
    });
}

if (btnToggleHiddenFooter) {
    btnToggleHiddenFooter.addEventListener('click', () => {
        showHiddenFiles = !showHiddenFiles;
        localStorage.setItem('termux_dirs_show_hidden', showHiddenFiles ? 'true' : 'false');
        updateHiddenStatusUI();
        navigateTo(currentPath);
    });
}

// ==========================================
// CONTROLES DE NAVEGAÇÃO E VIEW
// ==========================================
if (btnNavUp) {
    btnNavUp.addEventListener('click', () => {
        if (parentPath) navigateTo(parentPath);
    });
}

if (btnNavHome) {
    btnNavHome.addEventListener('click', () => navigateTo('~'));
}

if (btnRefresh) {
    btnRefresh.addEventListener('click', () => navigateTo(currentPath));
}

if (btnViewTree) {
    btnViewTree.addEventListener('click', () => {
        currentViewMode = 'tree';
        btnViewTree.className = 'px-2 py-1 rounded text-xs transition-colors bg-slate-800 text-amber-400 font-medium flex items-center gap-1';
        btnViewList.className = 'px-2 py-1 rounded text-xs transition-colors text-slate-400 hover:text-slate-200 flex items-center gap-1';
        renderCurrentView();
    });
}

if (btnViewList) {
    btnViewList.addEventListener('click', () => {
        currentViewMode = 'list';
        btnViewList.className = 'px-2 py-1 rounded text-xs transition-colors bg-slate-800 text-amber-400 font-medium flex items-center gap-1';
        btnViewTree.className = 'px-2 py-1 rounded text-xs transition-colors text-slate-400 hover:text-slate-200 flex items-center gap-1';
        renderCurrentView();
    });
}

// Filtro de Busca
if (searchInput) {
    searchInput.addEventListener('input', () => {
        if (btnClearSearch) {
            btnClearSearch.classList.toggle('hidden', !searchInput.value);
        }
        renderCurrentView();
    });
}

if (btnClearSearch) {
    btnClearSearch.addEventListener('click', () => {
        searchInput.value = '';
        btnClearSearch.classList.add('hidden');
        renderCurrentView();
    });
}

// ==========================================
// TERMUX BRIDGE UI LOGIC
// ==========================================
const termuxActionsModal = document.getElementById('termux-actions-modal');
const btnTermuxActions = document.getElementById('btn-termux-actions');
const btnCloseTermuxModal = document.getElementById('btn-close-termux-modal');
const btnDoneTermuxModal = document.getElementById('btn-done-termux-modal');
const btnCheckBridge = document.getElementById('btn-check-bridge');
const bridgeStatusDot = document.getElementById('bridge-status-dot');
const bridgeStatusText = document.getElementById('bridge-status-text');
const termuxAppInput = document.getElementById('termux-app-input');
const btnTermuxOpenTarget = document.getElementById('btn-termux-open-target');
const termuxCmdInput = document.getElementById('termux-cmd-input');
const btnTermuxRunCmd = document.getElementById('btn-termux-run-cmd');
const termuxOutputConsole = document.getElementById('termux-output-console');

async function checkTermuxBridgeStatus() {
    if (!bridgeStatusDot || !bridgeStatusText) return;
    bridgeStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse';
    bridgeStatusText.textContent = 'Checando conexão com Termux Bridge...';

    try {
        const res = await fetch('/api/termux/status');
        const data = await res.json();
        if (res.ok && data.status === 'online') {
            bridgeStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500';
            bridgeStatusText.textContent = `Bridge Online (Node ${data.nodeVersion || ''} - Termux Host)`;
        } else {
            throw new Error(data.error || 'Offline');
        }
    } catch (e) {
        bridgeStatusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500';
        bridgeStatusText.textContent = 'Bridge Offline (Inicie: node termux-bridge.js no Termux)';
    }
}

function openTermuxModal() {
    if (!termuxActionsModal) return;
    termuxActionsModal.classList.add('active');
    checkTermuxBridgeStatus();
}

function closeTermuxModal() {
    if (!termuxActionsModal) return;
    termuxActionsModal.classList.remove('active');
}

if (btnTermuxActions) btnTermuxActions.addEventListener('click', openTermuxModal);
if (btnCloseTermuxModal) btnCloseTermuxModal.addEventListener('click', closeTermuxModal);
if (btnDoneTermuxModal) btnDoneTermuxModal.addEventListener('click', closeTermuxModal);
if (btnCheckBridge) btnCheckBridge.addEventListener('click', checkTermuxBridgeStatus);

// Executar comando no Termux
if (btnTermuxRunCmd && termuxCmdInput) {
    btnTermuxRunCmd.addEventListener('click', async () => {
        const cmd = termuxCmdInput.value.trim();
        if (!cmd) return;

        btnTermuxRunCmd.disabled = true;
        btnTermuxRunCmd.textContent = 'Rodando...';
        termuxOutputConsole.textContent = `> ${cmd}\nExecutando no Termux nativo...`;

        try {
            const res = await fetch('/api/termux/exec', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ command: cmd })
            });
            const data = await res.json();
            const output = data.stdout || data.stderr || (data.success ? 'Comando executado com sucesso (sem saída).' : `Erro: ${data.error}`);
            termuxOutputConsole.textContent = `> ${cmd}\n[Status: ${data.success ? 'Sucesso' : 'Falha'}]\n\n${output}`;
        } catch (e) {
            termuxOutputConsole.textContent = `Erro ao comunicar com o Bridge: ${e.message}\nCertifique-se de que o 'node termux-bridge.js' está rodando no Termux nativo.`;
        } finally {
            btnTermuxRunCmd.disabled = false;
            btnTermuxRunCmd.textContent = 'Rodar';
        }
    });

    termuxCmdInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnTermuxRunCmd.click();
    });
}

// Abrir App ou URL no Android
if (btnTermuxOpenTarget && termuxAppInput) {
    btnTermuxOpenTarget.addEventListener('click', async () => {
        const target = termuxAppInput.value.trim();
        if (!target) return;

        btnTermuxOpenTarget.disabled = true;
        btnTermuxOpenTarget.textContent = 'Abrindo...';
        termuxOutputConsole.textContent = `> Abrindo no Android: ${target}...`;

        try {
            let res;
            if (target.startsWith('http://') || target.startsWith('https://') || target.startsWith('/')) {
                res = await fetch('/api/termux/open', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ target: target })
                });
            } else {
                res = await fetch('/api/termux/open-app', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ packageName: target })
                });
            }
            const data = await res.json();
            termuxOutputConsole.textContent = `> Abrir: ${target}\n[Status: ${data.success ? 'Sucesso' : 'Falha'}]\n${data.stdout || data.stderr || ''}`;
        } catch (e) {
            termuxOutputConsole.textContent = `Erro ao abrir: ${e.message}`;
        } finally {
            btnTermuxOpenTarget.disabled = false;
            btnTermuxOpenTarget.textContent = 'Abrir';
        }
    });

    termuxAppInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') btnTermuxOpenTarget.click();
    });
}

// Registro de Service Worker PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
}

// ==========================================
// INICIALIZAÇÃO
// ==========================================
applyCustomColors();
updateHiddenStatusUI();
initWebSocket();

