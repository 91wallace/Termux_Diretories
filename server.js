const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = parseInt(process.env.PORT, 10) || 3005;
const HOST = process.env.HOST || '0.0.0.0';
const DEFAULT_HOME = process.env.HOME || '/root';
const TERMUX_BRIDGE_URL = process.env.TERMUX_BRIDGE_URL || 'http://127.0.0.1:9099';

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Resolve e normaliza caminhos com suporte a ~
function resolvePath(targetPath) {
    if (!targetPath) return DEFAULT_HOME;
    let safePath = targetPath.trim();
    if (safePath === '~') {
        return DEFAULT_HOME;
    }
    if (safePath.startsWith('~/')) {
        return path.join(DEFAULT_HOME, safePath.substring(2));
    }
    if (path.isAbsolute(safePath)) {
        return path.normalize(safePath);
    }
    return path.resolve(DEFAULT_HOME, safePath);
}

// Formata tamanho legível
function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Lista diretório com detalhes
function getDirectoryContents(dirPath, showHidden = false) {
    return new Promise((resolve, reject) => {
        const resolved = resolvePath(dirPath);
        fs.readdir(resolved, { withFileTypes: true }, (err, entries) => {
            if (err) {
                return reject(err);
            }

            const filtered = showHidden ? entries : entries.filter(e => !e.name.startsWith('.'));
            
            const items = filtered.map(entry => {
                const fullPath = path.join(resolved, entry.name);
                let size = 0;
                let mtime = null;
                let isDir = entry.isDirectory();
                let isSymlink = entry.isSymbolicLink();
                let isFile = entry.isFile();

                try {
                    const stats = fs.statSync(fullPath);
                    size = stats.size;
                    mtime = stats.mtime;
                    isDir = stats.isDirectory();
                    isFile = stats.isFile();
                } catch (e) {
                    // Arquivo inacessível ou link quebrado
                }

                const ext = isDir ? '' : path.extname(entry.name).toLowerCase();

                return {
                    name: entry.name,
                    fullPath: fullPath,
                    isDirectory: isDir,
                    isFile: isFile,
                    isSymbolicLink: isSymlink,
                    size: size,
                    formattedSize: isDir ? '--' : formatBytes(size),
                    mtime: mtime,
                    extension: ext
                };
            }).sort((a, b) => {
                if (a.isDirectory && !b.isDirectory) return -1;
                if (!a.isDirectory && b.isDirectory) return 1;
                return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
            });

            // Retorna metadados do diretório atual
            let parentPath = path.dirname(resolved);
            if (resolved === '/' || resolved === parentPath) {
                parentPath = null;
            }

            resolve({
                currentPath: resolved,
                parentPath: parentPath,
                isRoot: resolved === '/',
                items: items,
                totalCount: items.length,
                dirCount: items.filter(i => i.isDirectory).length,
                fileCount: items.filter(i => !i.isDirectory).length
            });
        });
    });
}

// ==========================================
// REST API ENDPOINTS
// ==========================================

// Obter conteúdo de um diretório
app.get('/api/list', async (req, res) => {
    try {
        const targetPath = req.query.path || DEFAULT_HOME;
        const showHidden = req.query.showHidden === 'true';
        const data = await getDirectoryContents(targetPath, showHidden);
        res.json({ success: true, ...data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Ler conteúdo de um arquivo (Texto)
app.get('/api/file', (req, res) => {
    try {
        const filePath = resolvePath(req.query.path);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
            return res.status(400).json({ success: false, error: 'O caminho selecionado é uma pasta, não um arquivo.' });
        }

        // Limite de 5MB para visualização de texto
        if (stats.size > 5 * 1024 * 1024) {
            return res.status(413).json({ success: false, error: 'Arquivo muito grande para visualização direta (> 5MB).' });
        }

        fs.readFile(filePath, 'utf8', (err, content) => {
            if (err) {
                return res.status(500).json({ success: false, error: err.message });
            }
            res.json({
                success: true,
                path: filePath,
                name: path.basename(filePath),
                size: stats.size,
                formattedSize: formatBytes(stats.size),
                mtime: stats.mtime,
                content: content
            });
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Download bruto de arquivo
app.get('/api/raw', (req, res) => {
    try {
        const filePath = resolvePath(req.query.path);
        res.sendFile(filePath);
    } catch (err) {
        res.status(500).send('Erro ao baixar arquivo: ' + err.message);
    }
});

// Salvar / Editar conteúdo de arquivo
app.post('/api/file', (req, res) => {
    try {
        const { path: rawPath, content } = req.body;
        if (!rawPath) return res.status(400).json({ success: false, error: 'Caminho não fornecido.' });
        const filePath = resolvePath(rawPath);
        fs.writeFile(filePath, content || '', 'utf8', (err) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, path: filePath });
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Criar pasta
app.post('/api/mkdir', (req, res) => {
    try {
        const { path: rawPath } = req.body;
        if (!rawPath) return res.status(400).json({ success: false, error: 'Caminho não fornecido.' });
        const targetPath = resolvePath(rawPath);
        fs.mkdir(targetPath, { recursive: true }, (err) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, path: targetPath });
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Criar arquivo
app.post('/api/create-file', (req, res) => {
    try {
        const { path: rawPath, content = '' } = req.body;
        if (!rawPath) return res.status(400).json({ success: false, error: 'Caminho não fornecido.' });
        const targetPath = resolvePath(rawPath);
        fs.writeFile(targetPath, content, { flag: 'wx' }, (err) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, path: targetPath });
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Excluir item (arquivo ou pasta recursiva)
app.delete('/api/delete', (req, res) => {
    try {
        const targetPath = resolvePath(req.query.path);
        fs.rm(targetPath, { recursive: true, force: true }, (err) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, path: targetPath });
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// Renomear item
app.post('/api/rename', (req, res) => {
    try {
        const { oldPath, newPath } = req.body;
        if (!oldPath || !newPath) return res.status(400).json({ success: false, error: 'Caminhos inválidos.' });
        const src = resolvePath(oldPath);
        const dest = resolvePath(newPath);
        fs.rename(src, dest, (err) => {
            if (err) return res.status(500).json({ success: false, error: err.message });
            res.json({ success: true, oldPath: src, newPath: dest });
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ==========================================
// TERMUX BRIDGE API (Execução e Android Intents)
// ==========================================

// Helper para encaminhar requisições ao Termux Bridge
async function forwardToTermuxBridge(endpoint, method = 'POST', body = null) {
    const fetchOptions = {
        method: method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (body && method !== 'GET') {
        fetchOptions.body = JSON.stringify(body);
    }
    const response = await fetch(`${TERMUX_BRIDGE_URL}${endpoint}`, fetchOptions);
    const data = await response.json();
    return { status: response.status, data };
}

// Status do Termux Bridge
app.get('/api/termux/status', async (req, res) => {
    try {
        const { status, data } = await forwardToTermuxBridge('/status', 'GET');
        res.status(status).json(data);
    } catch (err) {
        res.status(503).json({ success: false, error: 'Termux Bridge offline ou inacessível em ' + TERMUX_BRIDGE_URL, details: err.message });
    }
});

// Executar comando no Termux nativo
app.post('/api/termux/exec', async (req, res) => {
    try {
        const { status, data } = await forwardToTermuxBridge('/exec', 'POST', req.body);
        res.status(status).json(data);
    } catch (err) {
        res.status(503).json({ success: false, error: 'Erro ao conectar ao Termux Bridge: ' + err.message });
    }
});

// Abrir app no Android
app.post('/api/termux/open-app', async (req, res) => {
    try {
        const { status, data } = await forwardToTermuxBridge('/android/open-app', 'POST', req.body);
        res.status(status).json(data);
    } catch (err) {
        res.status(503).json({ success: false, error: 'Erro ao conectar ao Termux Bridge: ' + err.message });
    }
});

// Abrir URL ou arquivo no Android
app.post('/api/termux/open', async (req, res) => {
    try {
        const { status, data } = await forwardToTermuxBridge('/android/open', 'POST', req.body);
        res.status(status).json(data);
    } catch (err) {
        res.status(503).json({ success: false, error: 'Erro ao conectar ao Termux Bridge: ' + err.message });
    }
});

// Enviar notificação nativa
app.post('/api/termux/notification', async (req, res) => {
    try {
        const { status, data } = await forwardToTermuxBridge('/android/notification', 'POST', req.body);
        res.status(status).json(data);
    } catch (err) {
        res.status(503).json({ success: false, error: 'Erro ao conectar ao Termux Bridge: ' + err.message });
    }
});

// Enviar toast
app.post('/api/termux/toast', async (req, res) => {
    try {
        const { status, data } = await forwardToTermuxBridge('/android/toast', 'POST', req.body);
        res.status(status).json(data);
    } catch (err) {
        res.status(503).json({ success: false, error: 'Erro ao conectar ao Termux Bridge: ' + err.message });
    }
});

// Bateria do Android
app.get('/api/termux/battery', async (req, res) => {
    try {
        const { status, data } = await forwardToTermuxBridge('/android/battery', 'GET');
        res.status(status).json(data);
    } catch (err) {
        res.status(503).json({ success: false, error: 'Erro ao conectar ao Termux Bridge: ' + err.message });
    }
});

// ==========================================
// WEBSOCKET HANDLERS (Comunicação Real-Time)
// ==========================================
wss.on('connection', (ws) => {
    ws.on('message', async (message) => {
        try {
            const parsed = JSON.parse(message);

            // Ação idêntica ao app principal: list_dir
            if (parsed.action === 'list_dir') {
                const targetPath = parsed.path || DEFAULT_HOME;
                const showHidden = parsed.showHidden === true;
                const requestId = parsed.requestId;

                try {
                    const result = await getDirectoryContents(targetPath, showHidden);
                    ws.send(JSON.stringify({
                        type: 'dir_list_result',
                        requestId: requestId,
                        path: result.currentPath,
                        parentPath: result.parentPath,
                        items: result.items,
                        dirCount: result.dirCount,
                        fileCount: result.fileCount,
                        totalCount: result.totalCount
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'dir_list_result',
                        requestId: requestId,
                        path: resolvePath(targetPath),
                        error: err.message,
                        items: []
                    }));
                }
            }

            // Ler conteúdo de arquivo
            if (parsed.action === 'read_file') {
                const filePath = resolvePath(parsed.path);
                const requestId = parsed.requestId;
                try {
                    const stats = fs.statSync(filePath);
                    if (stats.size > 5 * 1024 * 1024) {
                        return ws.send(JSON.stringify({
                            type: 'file_content_result',
                            requestId: requestId,
                            path: filePath,
                            error: 'Arquivo muito grande para visualização (> 5MB)'
                        }));
                    }
                    fs.readFile(filePath, 'utf8', (err, content) => {
                        if (err) {
                            return ws.send(JSON.stringify({
                                type: 'file_content_result',
                                requestId: requestId,
                                path: filePath,
                                error: err.message
                            }));
                        }
                        ws.send(JSON.stringify({
                            type: 'file_content_result',
                            requestId: requestId,
                            path: filePath,
                            name: path.basename(filePath),
                            size: stats.size,
                            formattedSize: formatBytes(stats.size),
                            content: content
                        }));
                    });
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'file_content_result',
                        requestId: requestId,
                        path: filePath,
                        error: err.message
                    }));
                }
            }

            // Salvar arquivo
            if (parsed.action === 'save_file') {
                const filePath = resolvePath(parsed.path);
                const content = parsed.content || '';
                const requestId = parsed.requestId;
                fs.writeFile(filePath, content, 'utf8', (err) => {
                    ws.send(JSON.stringify({
                        type: 'file_save_result',
                        requestId: requestId,
                        path: filePath,
                        success: !err,
                        error: err ? err.message : null
                    }));
                });
            }

            // Criar pasta
            if (parsed.action === 'mkdir') {
                const targetPath = resolvePath(parsed.path);
                const requestId = parsed.requestId;
                fs.mkdir(targetPath, { recursive: true }, (err) => {
                    ws.send(JSON.stringify({
                        type: 'mkdir_result',
                        requestId: requestId,
                        path: targetPath,
                        success: !err,
                        error: err ? err.message : null
                    }));
                });
            }

            // Criar arquivo
            if (parsed.action === 'create_file') {
                const targetPath = resolvePath(parsed.path);
                const requestId = parsed.requestId;
                fs.writeFile(targetPath, '', { flag: 'wx' }, (err) => {
                    ws.send(JSON.stringify({
                        type: 'create_file_result',
                        requestId: requestId,
                        path: targetPath,
                        success: !err,
                        error: err ? err.message : null
                    }));
                });
            }

            // Deletar item
            if (parsed.action === 'delete_item') {
                const targetPath = resolvePath(parsed.path);
                const requestId = parsed.requestId;
                fs.rm(targetPath, { recursive: true, force: true }, (err) => {
                    ws.send(JSON.stringify({
                        type: 'delete_result',
                        requestId: requestId,
                        path: targetPath,
                        success: !err,
                        error: err ? err.message : null
                    }));
                });
            }

            // Executar comando no Termux via WebSocket
            if (parsed.action === 'termux_exec') {
                const requestId = parsed.requestId;
                try {
                    const { data } = await forwardToTermuxBridge('/exec', 'POST', {
                        command: parsed.command,
                        timeout: parsed.timeout
                    });
                    ws.send(JSON.stringify({
                        type: 'termux_exec_result',
                        requestId: requestId,
                        ...data
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'termux_exec_result',
                        requestId: requestId,
                        success: false,
                        error: err.message
                    }));
                }
            }

            // Abrir App no Android via WebSocket
            if (parsed.action === 'termux_open_app') {
                const requestId = parsed.requestId;
                try {
                    const { data } = await forwardToTermuxBridge('/android/open-app', 'POST', {
                        packageName: parsed.packageName,
                        activity: parsed.activity,
                        uri: parsed.uri,
                        action: parsed.actionName,
                        flags: parsed.flags
                    });
                    ws.send(JSON.stringify({
                        type: 'termux_open_app_result',
                        requestId: requestId,
                        ...data
                    }));
                } catch (err) {
                    ws.send(JSON.stringify({
                        type: 'termux_open_app_result',
                        requestId: requestId,
                        success: false,
                        error: err.message
                    }));
                }
            }

        } catch (e) {
            console.error('[WS Error]', e);
        }
    });
});

server.listen(PORT, HOST, () => {
    console.log(`=========================================`);
    console.log(`📁 Termux Directories App iniciado!`);
    console.log(`🌐 Acesso Local:   http://localhost:${PORT}`);
    console.log(`📱 Acesso na Rede: http://${HOST === '0.0.0.0' ? '127.0.0.1' : HOST}:${PORT}`);
    console.log(`📂 Diretório Base: ${DEFAULT_HOME}`);
    console.log(`=========================================`);
});
