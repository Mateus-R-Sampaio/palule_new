# Studio Personalizado

Aplicação web (PWA) para personalização de produtos em tempo real: copos, camisetas, ecobags e bonés.

- **Loja / totem (`/`)**: o cliente escolhe o produto e aplica estampa, **a própria logo**, texto, cor da letra, tipografia, cor do produto, tamanho e acabamento, em seções retráteis. Depois revisa o carrinho com prévia de frente e costas, informa os dados (Evento, ou Encomenda com endereço), escolhe o pagamento (crédito, débito, Pix ou na retirada) e recebe o número do pedido.
- **Painel (`/admin.html`)**: login, pedidos em tempo real (Kanban com ficha técnica completa), catálogo e mockups, estampas, tipografias e identidade da marca.

## Arquitetura

```
Navegador (loja / painel)  ──HTTPS──▶  Servidor Node.js (server/)  ──▶  PostgreSQL
   só exibe e envia escolhas            valida TUDO contra o banco        dados, imagens e fontes
```

- **Banco de dados:** PostgreSQL 13 ou superior. Guarda produtos, estampas, fontes, configurações, pedidos, administradores, sessões, auditoria **e os arquivos** (mockups, estampas, logos), tudo em um único lugar para backup.
- **O navegador não é confiável:** ele envia só as escolhas do cliente. Preço, total, taxa de entrega, número do pedido, status, nomes de estampas e fontes são definidos pelo servidor a partir do banco.
- A pasta `img/` e o arquivo `js/defaults.js` **não são o banco**: servem só como origem do comando `npm run seed`, que importa o catálogo inicial para o PostgreSQL.

## Segurança

| Ameaça | Proteção |
| --- | --- |
| Adulterar preço ou total no navegador | O servidor recalcula tudo com os preços do banco; os valores enviados são ignorados (há teste para isso) |
| Pedir produto inativo, ou cor, tamanho, acabamento, estampa ou fonte inexistentes | Cada item é conferido no banco; costas só em produtos que permitem |
| Estampa ou logo fora da área de impressão | O servidor confere medidas e posição em cm contra a área real do produto |
| Dados malformados, injeção de SQL | Validação estrita (zod) de todos os campos + consultas parametrizadas + `CHECK`/`FK` no banco |
| Força bruta no login | Limite de tentativas por IP + bloqueio da conta após 5 erros (15 min) + resposta genérica (não revela se o e-mail existe) |
| Roubo de senha do banco | Senhas com **argon2id**; tokens de sessão guardados só como hash SHA-256 |
| Sequestro de sessão / CSRF | Cookie `HttpOnly` + `Secure` + `SameSite=Strict` (`__Host-`), checagem de origem e cabeçalho obrigatório em toda alteração |
| XSS | CSP restritiva (sem script inline nem de terceiros) e textos sempre escapados ao exibir |
| Upload malicioso | Tipo detectado pelos bytes (não pela extensão); imagens reprocessadas (sem metadados); SVG do admin sem scripts, eventos ou links externos e servido com `sandbox`; clientes só podem enviar PNG/JPG/WebP |
| Usar a logo de outra pessoa | Cada envio recebe um token secreto; o pedido só aceita a logo com o token certo, e as logos de clientes só são visíveis para administradores |
| Robôs e spam de pedidos | Limite por IP + campo-armadilha |
| Vazamento de arquivos do servidor | Só os arquivos do site são servidos (lista fixa); `.env`, código e `.git` dão 404 |
| Clickjacking, sniffing, downgrade | `frame-ancestors 'none'`, `nosniff`, HSTS, `Referrer-Policy`, `Permissions-Policy` |
| Auditoria | Login, falhas, bloqueios e toda alteração no painel ficam em `audit_log` |
| LGPD | O IP do pedido é guardado só como HMAC (pseudonimizado); pedidos e dados de clientes só são acessíveis no painel |

Os testes automáticos (`npm test`) atacam a API de propósito e conferem cada proteção acima.

## Rodar localmente

Pré-requisitos: Node.js 20.11+ e PostgreSQL 13+.

```bash
cd server
```
```bash
npm install
```
```bash
cp .env.example .env
```

Edite `server/.env`: em `DATABASE_URL`, aponte para o seu banco; para desenvolvimento, use `NODE_ENV=development` e `DATABASE_SSL=false`. Depois:

```bash
npm run seed
```
```bash
npm run create-admin -- voce@loja.com.br
```
```bash
npm run dev
```

Abra `http://localhost:3000` (loja) e `http://localhost:3000/admin.html` (painel).

Com Docker (banco + aplicação):

```bash
docker compose up -d --build
```
```bash
docker compose exec app node server/src/seed.js
```
```bash
docker compose exec app node server/src/create-admin.js voce@loja.com.br
```

## Colocar no ar

O GitHub Pages hospeda apenas arquivos: ele **não roda banco de dados nem servidor**. Para a loja funcionar online, publique o servidor (que também entrega o site).

**Opção recomendada: Render** (o arquivo `render.yaml` já está pronto)

1. Em [render.com](https://render.com), vá em **New → Blueprint** e selecione este repositório. Ele cria o PostgreSQL e o serviço web.
2. No **Shell** do serviço, rode `node server/src/seed.js` e depois `node server/src/create-admin.js voce@loja.com.br`.
3. Acesse a URL do serviço (ex.: `https://studio-personalizado.onrender.com`). A loja fica em `/` e o painel em `/admin.html`.
4. Configure um domínio próprio com HTTPS no Render, se quiser.

Também funciona em Railway, Fly.io, VPS com Docker, Azure App Service com Azure Database for PostgreSQL, entre outros: basta rodar o `Dockerfile` com as variáveis do `server/.env.example`.

**Manter a loja no GitHub Pages (opcional)**

1. No GitHub, abra **Settings → Secrets and variables → Actions → Variables** e crie `STUDIO_API_BASE` com a URL do servidor.
2. No servidor, coloque `https://mateus-r-sampaio.github.io` em `ALLOWED_ORIGINS`.
3. A loja no Pages passa a usar a API. O painel admin sempre redireciona para o domínio do servidor, porque o cookie de sessão é `SameSite=Strict`.

**Checklist de produção**
- `NODE_ENV=production`, HTTPS ativo e `IP_HASH_SECRET` aleatório com 32+ caracteres (o servidor se recusa a iniciar sem ele).
- `DATABASE_SSL=true` se o banco estiver fora da rede interna do provedor.
- Backups automáticos do PostgreSQL ativados no provedor.
- Senhas de admin com 12+ caracteres. Para redefinir uma senha esquecida, use `npm run create-admin -- email` no servidor.

## Notificações (e-mail + WhatsApp/SMS)

O próprio servidor envia as mensagens ao criar o pedido e a cada mudança de status. O resultado fica gravado no pedido e aparece no painel, que também tem o botão **Reenviar notificação**.

| Canal | Variável | Opções |
| --- | --- | --- |
| E-mail | `EMAIL_PROVIDER` | `resend`, `sendgrid`, `smtp`, `none` |
| Mensagem | `MESSAGE_PROVIDER` | `whatsapp_cloud` (Meta), `zapi`, `evolution`, `twilio_sms`, `twilio_whatsapp`, `none` |

Modelo da mensagem: `Olá, {{cliente_nome}}! Seu pedido *#{{codigo_curto}}* está com o status: *{{status_label}}*.`

As chaves dos provedores ficam **só** nas variáveis de ambiente do servidor, nunca no navegador nem no banco.

**Webhook de pagamento:** `POST /api/webhooks/payment` com o header `x-webhook-secret: <PAYMENT_WEBHOOK_SECRET>` e o corpo `{ "numero_pedido": "...", "status": "PAGO" }`. Ao confirmar o pagamento, o pedido vai para a fila e o cliente é avisado.

## Logo do cliente

A seção **Sua logo** aceita PNG, JPG, WebP ou SVG (o SVG é convertido no navegador) de até 10 MB, em qualquer produto e em cada lado. A imagem é enviada na hora ao servidor, que confere o formato real, regrava o arquivo e devolve a área visível e um token de posse. Logos nunca usadas em pedidos são apagadas automaticamente após 48 horas.

## Tipografias

São 137 fontes de 5 bancos, carregadas sob demanda: Google Fonts (85), Fontshare (16), Bunny Fonts (14), Fontsource (13) e fontes do sistema (9). Além delas, a loja pode enviar fontes próprias pelo painel. O admin escolhe quais fontes ficam disponíveis e qual é a padrão; o servidor só aceita pedidos com fontes habilitadas.

## Estrutura

```
index.html, admin.html, styles.css, admin.css   Site (loja e painel)
js/app.js, js/admin.js                          Lógica da loja e do painel
js/store.js, js/config.js                       Cliente da API (endereço do servidor)
js/render.js, js/fonts.js, js/pix.js …          Prévia em cm, tipografias, Pix (compartilhados com o servidor)
server/src/app.js                               Rotas da API e entrega do site
server/src/orders.js                            Validação de pedidos contra o banco
server/src/auth.js, security.js                 Login, sessões, CSRF, limites, cabeçalhos
server/src/files.js                             Upload e entrega de arquivos
server/src/notify.js                            E-mail e WhatsApp/SMS
server/migrations/*.sql                         Esquema do PostgreSQL
server/test/                                    Testes de segurança e regras
Dockerfile, docker-compose.yml, render.yaml      Implantação
```
