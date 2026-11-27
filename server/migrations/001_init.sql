-- Studio Personalizado — esquema inicial (PostgreSQL 14+)
-- Todas as regras críticas também são garantidas pelo banco (CHECK, FK, UNIQUE),
-- além da validação feita na API.

-- Requer PostgreSQL 13+ (gen_random_uuid nativo). Nenhuma extensão é necessária.

-- ---------------------------------------------------------------- Admin
CREATE TABLE admin_users (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email            text NOT NULL CHECK (length(email) BETWEEN 5 AND 160 AND email = lower(email)),
  name             text   NOT NULL DEFAULT '' CHECK (length(name) <= 80),
  password_hash    text   NOT NULL,
  active           boolean NOT NULL DEFAULT true,
  failed_attempts  integer NOT NULL DEFAULT 0,
  locked_until     timestamptz,
  last_login_at    timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_users_email_idx ON admin_users (email);

CREATE TABLE admin_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  token_hash  bytea NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  ip          inet,
  user_agent  text CHECK (length(user_agent) <= 300)
);
CREATE INDEX admin_sessions_user_idx ON admin_sessions (user_id);
CREATE INDEX admin_sessions_expires_idx ON admin_sessions (expires_at);

CREATE TABLE audit_log (
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  action      text NOT NULL CHECK (length(action) <= 80),
  target      text CHECK (length(target) <= 120),
  details     jsonb,
  ip          inet
);
CREATE INDEX audit_log_at_idx ON audit_log (at DESC);

-- ---------------------------------------------------------------- Arquivos
-- Imagens e fontes ficam no próprio banco (bytea): um único lugar para backup.
CREATE TABLE files (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind              text NOT NULL CHECK (kind IN ('mockup', 'art', 'brand', 'font', 'customer_logo')),
  content_type      text NOT NULL CHECK (content_type IN (
                      'image/png', 'image/jpeg', 'image/webp', 'image/svg+xml',
                      'font/woff2', 'font/woff', 'font/ttf', 'font/otf')),
  size_bytes        integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 10485760),
  sha256            bytea NOT NULL,
  data              bytea NOT NULL,
  original_name     text CHECK (length(original_name) <= 200),
  width             integer,
  height            integer,
  bounds            jsonb,              -- área visível (sem transparência), frações 0..1
  upload_token_hash bytea,            -- logos de clientes: prova de posse do upload
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_kind_created_idx ON files (kind, created_at);

-- ---------------------------------------------------------------- Loja
CREATE TABLE settings (
  id          smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  data        jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  uuid REFERENCES admin_users(id) ON DELETE SET NULL
);

CREATE TABLE products (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,59}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  price       numeric(10, 2) NOT NULL CHECK (price >= 0 AND price <= 100000),
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  config      jsonb NOT NULL,          -- validado pela API (zod)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE arts (
  id          text PRIMARY KEY CHECK (id ~ '^[a-z0-9][a-z0-9-]{0,79}$'),
  name        text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  category    text NOT NULL DEFAULT 'Geral' CHECK (length(category) BETWEEN 1 AND 40),
  file_id     uuid NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  active      boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE custom_fonts (
  id          text PRIMARY KEY CHECK (id ~ '^custom-[a-z0-9-]{1,80}$'),
  family      text NOT NULL CHECK (family ~ '^[A-Za-zÀ-ÿ0-9 _-]{2,60}$'),
  category    text NOT NULL CHECK (category IN ('sans', 'serif', 'display', 'script', 'hand', 'mono', 'retro')),
  file_id     uuid NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- Pedidos
CREATE TABLE order_counters (
  day   date PRIMARY KEY,
  seq   integer NOT NULL CHECK (seq >= 1000)
);

CREATE TABLE orders (
  id                 bigserial PRIMARY KEY,
  numero             text NOT NULL UNIQUE CHECK (numero ~ '^[A-Z0-9]{1,8}-[0-9]{8}-[0-9]{4,6}$'),
  codigo_curto       text NOT NULL CHECK (codigo_curto ~ '^[0-9]{4,6}$'),
  modalidade         text NOT NULL CHECK (modalidade IN ('EVENTO', 'ENCOMENDA')),
  cliente_nome       text NOT NULL CHECK (length(cliente_nome) BETWEEN 3 AND 120),
  cliente_telefone   text NOT NULL CHECK (cliente_telefone ~ '^[0-9]{10,11}$'),
  cliente_email      text NOT NULL CHECK (length(cliente_email) BETWEEN 5 AND 160),
  endereco           jsonb,
  itens              jsonb NOT NULL CHECK (jsonb_typeof(itens) = 'array' AND jsonb_array_length(itens) BETWEEN 1 AND 50),
  quantidade_itens   integer NOT NULL CHECK (quantidade_itens BETWEEN 1 AND 500),
  subtotal           numeric(10, 2) NOT NULL CHECK (subtotal >= 0),
  taxa_entrega       numeric(10, 2) NOT NULL DEFAULT 0 CHECK (taxa_entrega >= 0),
  valor_total        numeric(10, 2) NOT NULL CHECK (valor_total >= 0),
  metodo_pagamento   text NOT NULL CHECK (metodo_pagamento IN ('CREDITO', 'DEBITO', 'PIX', 'PAGAR_NA_RETIRADA')),
  status_pagamento   text NOT NULL DEFAULT 'PENDENTE' CHECK (status_pagamento IN ('PENDENTE', 'PAGO', 'CANCELADO')),
  status_producao    text NOT NULL CHECK (status_producao IN
                       ('AGUARDANDO_PAGAMENTO', 'EM_FILA', 'EM_PRODUCAO', 'PRONTO_PARA_RETIRADA', 'ENTREGUE')),
  notificacoes       jsonb NOT NULL DEFAULT '{}'::jsonb,
  origem             text NOT NULL DEFAULT 'web' CHECK (origem IN ('web', 'totem')),
  ip_hash            bytea,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((modalidade = 'EVENTO' AND endereco IS NULL) OR (modalidade = 'ENCOMENDA' AND endereco IS NOT NULL)),
  CHECK (valor_total = subtotal + taxa_entrega)
);
CREATE INDEX orders_created_idx ON orders (created_at DESC);
CREATE INDEX orders_status_idx ON orders (status_producao);
CREATE INDEX orders_updated_idx ON orders (updated_at DESC);

CREATE TABLE order_history (
  id          bigserial PRIMARY KEY,
  order_id    bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  status      text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  user_id     uuid REFERENCES admin_users(id) ON DELETE SET NULL,
  origem      text NOT NULL DEFAULT 'sistema'
);
CREATE INDEX order_history_order_idx ON order_history (order_id, at);

-- Logos de clientes usados em pedidos não podem ser apagados pela limpeza automática.
CREATE TABLE order_files (
  order_id  bigint NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  file_id   uuid   NOT NULL REFERENCES files(id) ON DELETE RESTRICT,
  PRIMARY KEY (order_id, file_id)
);

-- Controle de migrações
CREATE TABLE IF NOT EXISTS schema_migrations (
  name        text PRIMARY KEY,
  applied_at  timestamptz NOT NULL DEFAULT now()
);
