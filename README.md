# 📁 Termux Directories - Standalone App & Android Bridge

Aplicativo web PWA mobile-first standalone para navegação, exploração e gerenciamento de arquivos e diretórios no **PRoot / Termux / Android / Linux**, com capacidade de acionar comandos e funções nativas do Android via **Termux Bridge**.

---

## 🏗️ Arquitetura PRoot + Termux Bridge

```
┌─────────────────────────────────────────────────────────┐
│                     ANDROID SYSTEM                      │
│                                                         │
│   ┌─────────────────────────────────────────────────┐   │
│   │             TERMUX NATIVO (HOST)                │   │
│   │   • termux-bridge.js (Porta 9099 - sem deps)    │   │
│   │   • Executa: am start, termux-open, intents     │   │
│   └──────────────────────▲──────────────────────────┘   │
│                          │ HTTP (localhost:9099)        │
│   ┌──────────────────────▼──────────────────────────┐   │
│   │                 PROOT (LINUX)                   │   │
│   │   • server.js (Porta 3005 - Express/WS)         │   │
│   │   • Acesso total aos arquivos do Linux          │   │
│   │   • Interface Web PWA / Gerenciador             │   │
│   └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 🚀 Como Executar

### 1. No Termux Nativo (Host Android):
Inicie o bridge leve do Termux (não precisa de dependências externas):
```bash
node termux-bridge.js
# Ficará ativo em: http://127.0.0.1:9099
```

### 2. No PRoot (Debian/Ubuntu):
Inicie o servidor principal da aplicação web:
```bash
npm install # apenas na primeira vez
npm start
# Ficará ativo em: http://127.0.0.1:3005
```

### 3. Acessar no Navegador ou Instalar como App (PWA)
* **No aparelho:** `http://localhost:3005`
* **Na rede local (Wi-Fi):** `http://<IP-DO-SEU-DISPOSITIVO>:3005`

---

## 📡 Endpoints da API do Termux Bridge

O servidor no PRoot disponibiliza rotas integradas para acionar o Android via Termux:

* `GET /api/termux/status` - Verifica se o bridge do Termux está online.
* `POST /api/termux/exec` - Executa qualquer comando shell no Termux nativo. Payload: `{"command": "ls -la"}`.
* `POST /api/termux/open-app` - Abre um aplicativo do Android via intent (`am start`). Payload: `{"packageName": "com.brave.browser"}` ou `{"uri": "https://google.com"}`.
* `POST /api/termux/open` - Abre um arquivo ou link com o app padrão do Android (`termux-open`). Payload: `{"target": "/sdcard/documento.pdf"}`.
* `POST /api/termux/notification` - Dispara uma notificação nativa do Android. Payload: `{"title": "Título", "content": "Mensagem"}`.
* `POST /api/termux/toast` - Mostra um Toast nativo na tela do Android. Payload: `{"text": "Operação realizada!"}`.
* `GET /api/termux/battery` - Retorna status da bateria do dispositivo.

---

## ✨ Funcionalidades da Interface

* 🌳 **Visualização em Árvore Hierárquica:** Expansão e recolhimento instantâneo de subpastas com chevrons animados.
* 📋 **Modo Lista Detalhada:** Alternância rápida entre visão em árvore e visão em tabela detalhada com tamanho de arquivos e metadados.
* 🧭 **Breadcrumbs Interativos:** Barra de navegação com saltos diretos para qualquer pasta superior.
* 🔍 **Filtro / Busca em Tempo Real:** Pesquisa instantânea por nome enquanto digita.
* 📄 **Visualizador e Editor de Arquivos:** Toque em qualquer arquivo de texto/código para ler e salvar edições com contagem de tamanho e botão de cópia com 1 clique.
* ➕ **Criação de Itens:** Criação rápida de novas pastas (`mkdir`) e novos arquivos.
* 🗑️ **Exclusão Segura:** Botão de exclusão com diálogo de confirmação.
* 🎨 **Personalização de Cores:** Seletor de cores em tempo real (com tons Neon e clássicos) para pastas e arquivos com persistência local.
* 👁️ **Alternância de Arquivos Ocultos:** Botão para exibir ou ocultar arquivos ponto (`.dotfiles`).
* 📱 **PWA Standalone:** Totalmente instalável na tela inicial do Android via Chrome / Samsung Internet.
