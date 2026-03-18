# 🎵 Web Player

Um player de música local para o navegador, com design minimalista, integração com Spotify para busca de metadados e suporte a scrobbling via Last.fm. Roda 100% no seu navegador — nenhum servidor, nenhum backend.

![Static Badge](https://img.shields.io/badge/feito_com-HTML%2C_CSS%2C_JS-black?style=flat-square)
![Static Badge](https://img.shields.io/badge/armazenamento-IndexedDB-black?style=flat-square)
![Static Badge](https://img.shields.io/badge/licença-MIT-black?style=flat-square)

---

## ✨ Funcionalidades

- **Reprodução local** — carregue arquivos de áudio diretamente do seu computador, sem upload para nenhum servidor
- **Biblioteca persistente** — as músicas ficam salvas no IndexedDB do navegador e continuam disponíveis ao reabrir o site
- **Busca de metadados via Spotify** — cole o link de uma faixa do Spotify para buscar automaticamente capa, nome e artista
- **Scrobbling via Last.fm** — registre automaticamente o que você ouve na sua conta do Last.fm
- **Fila de reprodução** — adicione músicas à fila ou escolha "tocar em seguida" pelo menu de contexto
- **Modo aleatório e repetição**
- **Busca na biblioteca** — filtra músicas por nome ou artista em tempo real
- **Drag & drop** — reordene as músicas arrastando pela alça
- **Adição em lote** — arraste vários arquivos de uma vez para adicionar múltiplas músicas
- **Atalhos de teclado** — controle o player sem usar o mouse
- **Cursor customizado**
- **Design responsivo** com fundo desfocado dinâmico baseado na capa do álbum

---

## 🔒 Segurança e privacidade

Todas as credenciais (Spotify e Last.fm) são **criptografadas localmente** no seu navegador usando **AES-GCM 256-bit** com derivação de chave via **PBKDF2** (600.000 iterações). Uma senha é definida na primeira abertura e nunca sai do dispositivo.

> **Atenção:** requisições à API do Spotify podem passar por proxies CORS de terceiros (`corsproxy.io`, `allorigins.win`) caso o ambiente não permita acesso direto. As credenciais são enviadas apenas no header `Authorization`, mas esteja ciente disso ao usar redes não confiáveis.

---

## 🚀 Como usar

### Sem instalar nada

Acesse diretamente em: `https://joaopdalves.github.io/web-player`

### Rodando localmente

Clone o repositório e abra o `index.html` em qualquer navegador moderno. Não é necessário nenhum servidor.

```bash
git clone https://github.com/joaopdalves/web-player.git
cd web-player
# Abra index.html no navegador
```

---

## ⚙️ Configuração

### Spotify API (necessário para busca de metadados)

1. Acesse [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) e faça login
2. Clique em **"Create app"** e preencha qualquer nome e descrição
3. No campo **Redirect URI**, coloque: `http://localhost`
4. Abra o app criado, vá em **Settings** e copie o **Client ID** e o **Client Secret**
5. Cole as credenciais na tela de configuração do player

> As credenciais são gratuitas e o plano free do Spotify Developer é suficiente.

### Last.fm (opcional — para scrobbling)

1. Acesse [last.fm/api/account/create](https://www.last.fm/api/account/create) e crie um app gratuito
2. Copie sua **API Key** e **Shared Secret**
3. No player, vá nas configurações, cole as chaves e clique em **"Autenticar com Last.fm"**
4. Autorize o acesso na página do Last.fm e volte ao player

> O scrobble é registrado após ouvir pelo menos **50% da faixa** (ou 4 minutos, o que vier primeiro), seguindo a especificação oficial do Last.fm. Músicas sem link do Spotify não são scrobbladas.

---

## ⌨️ Atalhos de teclado

| Tecla | Ação |
|---|---|
| `Espaço` | Play / Pause |
| `→` | Avançar 5 segundos |
| `←` | Voltar 5 segundos |
| `↑` | Aumentar volume |
| `↓` | Diminuir volume |
| `N` | Próxima música |
| `P` | Música anterior |

---

## 📁 Formatos suportados

`MP3` · `FLAC` · `WAV` · `OGG` · `M4A` · `AAC` · `OPUS` · `WMA` · `AIFF` e qualquer formato suportado pelo navegador.

---

## 🗂️ Estrutura do projeto

```
/
├── index.html       # Estrutura e overlays da interface
├── player.css       # Estilos e variáveis de tema
├── player.js        # Toda a lógica do player
├── cursor/
│   └── cursor.png   # Cursor customizado
└── icon/
    └── favicon.png  # Ícone da aba
```

---

## 🛠️ Tecnologias

- **HTML / CSS / JavaScript** puros — sem frameworks, sem dependências externas
- **IndexedDB** — armazenamento persistente dos arquivos de áudio e metadados
- **Web Crypto API** — criptografia das credenciais
- **Web Audio API** (elemento `<audio>` nativo)
- **Spotify Web API** — busca de metadados de faixas
- **Last.fm API** — autenticação e scrobbling
- **Virtual scroll** — renderização eficiente de bibliotecas grandes
