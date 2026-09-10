/**
 * Termux Bridge Server
 * 
 * Este servidor roda NATIVAMENTE no Termux (porta padrão 9099)
 * e atua como uma ponte (bridge) para executar comandos do sistema Android / Termux API
 * quando solicitado pelo servidor principal que roda dentro do PRoot.
 * 
 * Dependências: Nenhuma externa! (Usa módulos nativos do Node.js: http, child_process, url)
 * 
 * Como rodar no Termux:
 *   node termux-bridge.js
 *   ou com porta customizada:
 *   PORT=9099 node termux-bridge.js
 */

const http = require('http');
const { exec } = require('child_process');
const url = require('url');

const PORT = parseInt(process.env.BRIDGE_PORT || process.env.PORT, 10) || 9099;
const HOST = '127.0.0.1'; // Aceita apenas conexões locais para máxima segurança

// Utilitário para enviar respostas JSON
function sendJSON(res, statusCode, data) {
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end(JSON.stringify(data));
}

// Utilitário para extrair body JSON de requisição POST
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';
        req.on('data', chunk => {
            body += chunk.toString();
            if (body.length > 1e6) {
                req.destroy();
                reject(new Error('Payload muito grande'));
            }
        });
        req.on('end', () => {
            if (!body.trim()) return resolve({});
            try {
                resolve(JSON.parse(body));
            } catch (err) {
                reject(new Error('JSON malformatado: ' + err.message));
            }
        });
        req.on('error', reject);
    });
}

// Execução segura de comandos shell nativos no Termux
function runTermuxCommand(command, options = {}) {
    return new Promise((resolve) => {
        const timeout = options.timeout || 30000;
        exec(command, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
            resolve({
                success: !error,
                exitCode: error ? error.code || 1 : 0,
                stdout: stdout || '',
                stderr: stderr || (error ? error.message : ''),
                command: command
            });
        });
    });
}

const server = http.createServer(async (req, res) => {
    // Tratamento de CORS Preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204, {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type'
        });
        return res.end();
    }

    const parsedUrl = url.parse(req.url, true);
    const pathname = parsedUrl.pathname;

    try {
        // 1. Healthcheck / Status do Bridge
        if (req.method === 'GET' && pathname === '/status') {
            return sendJSON(res, 200, {
                status: 'online',
                service: 'termux-bridge',
                timestamp: new Date().toISOString(),
                nodeVersion: process.version,
                arch: process.arch,
                platform: process.platform
            });
        }

        // 2. Executar comando genérico no ambiente nativo do Termux
        if (req.method === 'POST' && pathname === '/exec') {
            const { command, timeout } = await parseBody(req);
            if (!command || typeof command !== 'string') {
                return sendJSON(res, 400, { success: false, error: 'O campo "command" (string) é obrigatório.' });
            }

            console.log(`[Bridge Exec] ${command}`);
            const result = await runTermuxCommand(command, { timeout });
            return sendJSON(res, result.success ? 200 : 500, result);
        }

        // 3. Abrir aplicativo ou Activity no Android (am start / monkey / termux-open)
        if (req.method === 'POST' && pathname === '/android/open-app') {
            const { packageName, activity, uri, action, flags } = await parseBody(req);

            let cmd = '';

            if (packageName && !activity && !uri && !action) {
                // Modo mais compatível e universal no Android sem root (não dá erro de permissão)
                cmd = `monkey -p "${packageName}" -c android.intent.category.LAUNCHER 1`;
            } else if (activity) {
                cmd = `am start --user 0 -n "${packageName}/${activity}"`;
            } else if (uri) {
                cmd = `am start --user 0 -a android.intent.action.VIEW -d "${uri}"`;
            } else {
                let actionFlag = action ? `-a "${action}"` : '-a android.intent.action.MAIN';
                cmd = `am start --user 0 ${actionFlag} -p "${packageName}"`;
            }

            if (flags) {
                cmd += ` -f ${flags}`;
            }

            console.log(`[Bridge Open App] ${cmd}`);
            let result = await runTermuxCommand(cmd);

            // Fallback se o comando principal falhar
            if (!result.success && packageName) {
                console.log(`[Bridge Open App Fallback] Tentando via am start simples...`);
                result = await runTermuxCommand(`am start -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -p "${packageName}"`);
            }

            return sendJSON(res, result.success ? 200 : 500, result);
        }

        // 3.1 Listar aplicativos instalados no Android
        if (req.method === 'GET' && pathname === '/android/apps') {
            const result = await runTermuxCommand('pm list packages -f -3 || pm list packages -3 || pm list packages');
            const lines = result.stdout.split('\n').filter(l => l.trim().startsWith('package:'));
            const apps = lines.map(line => {
                const raw = line.replace('package:', '').trim();
                if (raw.includes('=')) {
                    const parts = raw.split('=');
                    return { apkPath: parts[0], packageName: parts[1] };
                }
                return { apkPath: '', packageName: raw };
            });
            return sendJSON(res, 200, { success: true, count: apps.length, apps: apps });
        }

        // 4. Abrir arquivo / URL com o aplicativo padrão do Android (termux-open ou termux-open-url)
        if (req.method === 'POST' && pathname === '/android/open') {
            const { target, send } = await parseBody(req);
            if (!target) {
                return sendJSON(res, 400, { success: false, error: 'O campo "target" (arquivo ou URL) é obrigatório.' });
            }

            let cmd = '';
            if (target.startsWith('http://') || target.startsWith('https://')) {
                cmd = `termux-open-url "${target}"`;
            } else {
                const sendFlag = send ? '--send' : '';
                cmd = `termux-open ${sendFlag} "${target}"`;
            }

            console.log(`[Bridge Open] ${cmd}`);
            const result = await runTermuxCommand(cmd);
            return sendJSON(res, result.success ? 200 : 500, result);
        }

        // 5. Enviar notificação nativa do Android (Termux:API)
        if (req.method === 'POST' && pathname === '/android/notification') {
            const { title = 'Termux App', content = '', id, priority = 'default', url: actionUrl } = await parseBody(req);

            let cmd = `termux-notification --title "${title.replace(/"/g, '\\"')}" --content "${content.replace(/"/g, '\\"')}" --priority ${priority}`;
            if (id) cmd += ` --id "${id}"`;
            if (actionUrl) cmd += ` --action "termux-open-url ${actionUrl}"`;

            console.log(`[Bridge Notification] ${title}`);
            const result = await runTermuxCommand(cmd);
            return sendJSON(res, result.success ? 200 : 500, result);
        }

        // 6. Enviar Toast nativo (Termux:API)
        if (req.method === 'POST' && pathname === '/android/toast') {
            const { text = '', short = false } = await parseBody(req);
            const shortFlag = short ? '-s' : '';
            const cmd = `termux-toast ${shortFlag} "${text.replace(/"/g, '\\"')}"`;

            console.log(`[Bridge Toast] ${text}`);
            const result = await runTermuxCommand(cmd);
            return sendJSON(res, result.success ? 200 : 500, result);
        }

        // 7. Vibrar o dispositivo (Termux:API)
        if (req.method === 'POST' && pathname === '/android/vibrate') {
            const { duration = 500 } = await parseBody(req);
            const cmd = `termux-vibrate -d ${parseInt(duration, 10) || 500}`;

            const result = await runTermuxCommand(cmd);
            return sendJSON(res, result.success ? 200 : 500, result);
        }

        // 8. Obter Informações do Sistema Android (Bateria)
        if (req.method === 'GET' && pathname === '/android/battery') {
            const result = await runTermuxCommand('termux-battery-status');
            try {
                const parsed = JSON.parse(result.stdout);
                return sendJSON(res, 200, { success: true, battery: parsed });
            } catch (e) {
                return sendJSON(res, 200, result);
            }
        }

        return sendJSON(res, 404, { success: false, error: `Rota [${req.method}] ${pathname} não encontrada.` });

    } catch (err) {
        console.error('[Bridge Error]', err);
        return sendJSON(res, 500, { success: false, error: err.message });
    }
});

server.listen(PORT, HOST, () => {
    console.log(`=======================================================`);
    console.log(`🚀 Termux Android Bridge Server Rodando com Sucesso!`);
    console.log(`📡 Endereço: http://${HOST}:${PORT}`);
    console.log(`🔗 Pronto para receber chamadas do servidor no PRoot.`);
    console.log(`=======================================================`);
});
