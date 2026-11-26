# Studio Personalizado

Aplicação web (PWA) para personalização de produtos em tempo real: copos, camisetas, ecobags e bonés. Tem duas áreas:

- **Loja / totem (`index.html`)**: o cliente escolhe o produto; aplica estampa, texto, cor da letra, tipografia, cor do produto, tamanho e acabamento; revisa o carrinho com prévia de frente e costas; informa os dados (Evento ou Encomenda com endereço) e escolhe o pagamento (crédito, débito, Pix ou pagar na retirada). No fim, recebe o número do pedido.
- **Painel admin (`admin.html`)**: login, pedidos em tempo real (Kanban com ficha técnica completa), catálogo e mockups, estampas, tipografias e identidade da marca.

## Como rodar

O site é estático (HTML, CSS e JS em módulos), sem etapa de build. Ele só precisa ser servido por HTTP, porque não abre via `file://`:

```bash
python3 -m http.server 8080
```

Depois, abra `http://localhost:8080` (loja) e `http://localhost:8080/admin.html` (painel).

### Modo local (padrão)

Se o arquivo `firebase-config.js` não existir, tudo fica no navegador (`localStorage`). Serve para demonstração e testes em um único dispositivo. Loja e painel abertos em abas do mesmo navegador se atualizam sozinhos.

- Login inicial do painel: **`admin@studio.local` / `admin123`**. Altere em *Marca & Config.*
- Nesse modo, as notificações automáticas não são enviadas. O painel oferece atalhos para avisar o cliente pelo WhatsApp e por e-mail manualmente.

### Modo nuvem (Firebase)

Use este modo em produção: loja e painel em dispositivos diferentes, login seguro e notificações automáticas.

1. Crie um projeto no [Firebase](https://console.firebase.google.com) e ative **Authentication (e-mail/senha)**, **Firestore**, **Storage** e **Functions** (requer o plano Blaze).
2. Copie `firebase-config.example.js` para `firebase-config.js` e cole a configuração do app Web.
3. Em *Authentication*, crie o usuário administrador. No Firestore, crie o documento **`admins/{UID do usuário}`** (pode ser vazio).
4. Instale a CLI e publique:
   ```bash
   npm install -g firebase-tools
   ```
   ```bash
   firebase login
   ```
   ```bash
   firebase use --add
   ```
   ```bash
   cd functions && npm install && cp .env.example .env && cd ..
   ```
   ```bash
   firebase deploy
   ```
5. Libere o CORS do Storage. Sem isso, a cor do mockup e o recorte das estampas enviadas não funcionam:
   ```bash
   gsutil cors set cors.json gs://SEU-BUCKET
   ```
6. No painel, aba *Catálogo*, clique em **Importar catálogo padrão** para começar com os 4 produtos e as 27 estampas.

## Notificações (e-mail + WhatsApp/SMS)

As Cloud Functions (`functions/`) disparam automaticamente:

- **Pedido criado**: confirmação com o número e o status inicial. O servidor também recalcula o total; se o valor enviado pelo navegador for diferente, o pedido recebe o alerta “Conferir valor”.
- **Mudança de status no Kanban**: aviso com o novo status.
- **“Reenviar notificação”** no painel: envia de novo.

Os provedores são configurados em `functions/.env` (veja `.env.example`):

| Canal | Opções |
| --- | --- |
| E-mail | `resend`, `sendgrid`, `smtp` |
| Mensagem | `whatsapp_cloud` (Meta), `zapi`, `evolution`, `twilio_sms`, `twilio_whatsapp` |

O modelo da mensagem segue a especificação: `Olá, {{cliente_nome}}! Seu pedido *#{{codigo_curto}}* está com o status: *{{status_label}}*.`

O resultado de cada envio, ou o erro, fica registrado em `orders/{id}.notificacoes` e aparece no painel.

**Webhook de pagamento:** `paymentWebhook` recebe `POST { numero_pedido, status: "PAGO" }` com o header `x-webhook-secret`. Adapte o mapeamento ao seu gateway (Mercado Pago, Asaas, Stripe…). Ao confirmar o pagamento, o pedido vai para a fila e o cliente é avisado.

## Tipografias

São 137 fontes de **5 bancos diferentes**, carregadas sob demanda (só baixam quando aparecem na tela):

| Banco | Exemplos |
| --- | --- |
| Google Fonts (85) | As 15 originais (Montserrat, Poppins, Playfair Display, Bebas Neue, Lobster, Pacifico…) e mais Cinzel, Bangers, Satisfy, Amatic SC, Press Start 2P, Orbitron… |
| Fontshare / ITF (16) | Satoshi, Clash Display, General Sans, Cabinet Grotesk, Boska, Zodiak, Tanker, Panchang… |
| Bunny Fonts (14) | Inter, Josefin Sans, Sora, Teko, Kalam, Exo 2, Chakra Petch… |
| Fontsource / jsDelivr (13) | Bricolage Grotesque, Syne, Unbounded, Climate Crisis, Young Serif, Silkscreen… |
| Sistema (9) | Arial, Georgia, Impact, Comic Sans MS, Courier New… |

Mais as **fontes próprias da loja**: no painel, aba *Tipografias*, é possível enviar `.woff2/.woff/.ttf/.otf`, ativar ou desativar qualquer fonte do catálogo e definir a fonte padrão.

O seletor do cliente tem busca e filtros por estilo (sem serifa, serifada, display, caligrafia, manuscrita, mono, retrô) e por banco de fontes. Cada pedido grava a fonte, o banco de origem, a cor, o negrito/itálico, o tamanho em cm/pt e as dimensões do texto.

## Estrutura

```
index.html            Loja / totem (6 etapas)
admin.html            Painel administrativo
styles.css            Estilos base, loja e componentes compartilhados
admin.css             Estilos do painel
js/app.js             Lógica da loja (estado unificado por lado, editor, carrinho, checkout)
js/admin.js           Lógica do painel
js/store.js           Camada de dados: modo local ou Firebase (Auth, Firestore, Storage)
js/render.js          Prévia do produto e geometria em cm (editor, carrinho e painel)
js/fonts.js           Banco de tipografias e carregamento sob demanda
js/pix.js             Pix copia-e-cola (BR Code) + QR Code
js/keyboard.js        Teclado virtual do totem
js/defaults.js        Catálogo e configurações padrão
js/vendor/qrcode.js   qrcode-generator 1.4.4 (MIT), embutido para funcionar offline
sw.js, manifest.json  PWA (network-first para o site, cache-first para fontes/CDNs)
img/                  Mockups (SVG tingíveis) e 27 estampas de exemplo
functions/            Cloud Functions (notificações, conferência de valores, webhook)
firestore.rules       Regras: catálogo público, pedidos só para admin
storage.rules         Uploads só para admin
tools/generate-assets.mjs  Gera os mockups e estampas de exemplo
```

Os mockups e estampas em `img/` são substitutos em SVG. Troque pelas imagens reais pelo painel (*Catálogo & Mockups* e *Estampas*). Para colorir automaticamente, use o produto **em branco/cinza claro com fundo transparente**.

## O que foi corrigido em relação à versão anterior

- **Pedido com vários itens:** o pedido agora é montado só a partir do array `itens`. Cada item tem frente e costas, medidas em cm, acabamento e preço. Não há mais campos de item único na raiz do pedido.
- **Estado do editor unificado:** `state.sides = { front, back }`, com `getActiveSideState()`.
- **Limites físicos reais:** a estampa e o texto não saem da área de impressão nem ultrapassam `printCm` ao arrastar, redimensionar, girar ou digitar.
- **Acessibilidade:** o zoom foi liberado (sem `user-scalable=no`), há navegação por teclado no editor (setas, +/−, Delete) e foco visível.
- **Persistência em nuvem:** Firebase opcional, com fallback offline.
- **Cor do produto:** agora tinge o mockup de verdade (máscara CSS + `multiply`).

## Testes

```bash
cd functions && npm test
```
