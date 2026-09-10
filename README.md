# 📁 Termux Directories - Standalone App

Aplicativo web PWA mobile-first standalone para navegação, exploração e gerenciamento de arquivos e diretórios no **Termux / Android / Linux**.

---

## 🚀 Como Executar

### 1. Instalar dependências (apenas na 1ª vez)
```bash
cd /root/projects/Skill_agy/Termux_Diretories
npm install
```

### 2. Iniciar o servidor
```bash
npm start
# Ou especificando a porta:
PORT=3005 node server.js
```

### 3. Acessar no Navegador ou Instalar como App (PWA)
* **No aparelho:** `http://localhost:3005`
* **Na rede local (Wi-Fi):** `http://<IP-DO-SEU-DISPOSITIVO>:3005`

---

## ✨ Funcionalidades

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
