# Sonhar Conforto CRM

Aplicação completa (frontend Vite + backend Node/Express) para operação do CRM Sonhar Conforto. Toda a camada de dados roda exclusivamente no Supabase Cloud (PostgreSQL gerenciado + Auth).

## Requisitos

- Node.js 20+
- npm 10+
- Projeto Supabase com:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`

## Estrutura

```
.
├── server        # API (Express)
├── src           # Frontend React/Vite
├── public        # Assets do front
├── dist          # Build do front (gerado)
└── README.md
```

## Variáveis de ambiente

O repositório inclui exemplos (`.env.example` na raiz e `server/.env.example`).

- Frontend `.env` / `.env.local` *(opcional, o app busca do backend caso não definido)*
  ```
  VITE_API_URL=https://seu-dominio/api
  VITE_SUPABASE_URL=https://<ID>.supabase.co
  VITE_SUPABASE_ANON_KEY=chave-anon-gerada-pelo-Supabase
  ```

- Backend `server/.env`
  ```
  PORT=3333
  SUPABASE_URL=https://<ID>.supabase.co
  SUPABASE_ANON_KEY=chave-anon-gerada-pelo-Supabase
  SUPABASE_SERVICE_ROLE_KEY=chave-service-role
  ```

> **Importante:** apenas o backend usa a `SERVICE_ROLE_KEY`. Nunca exponha essa chave no frontend.

As tabelas do Supabase devem seguir o schema utilizado pela API (users, clients, products, stock_movements, sales, sale_items, sale_payments, assistances, finance_expenses, monthly_goals etc.). Os dados passam a ser visíveis diretamente no painel Supabase. Para manter o código das vendas sequencial (VEN-0001, VEN-0002, ...), crie também a tabela `sale_counter` e a função `increment_sale_sequence` no SQL Editor:

```sql
create table if not exists public.sale_counter (
  id integer primary key default 1,
  current integer not null default 0
);

create or replace function public.increment_sale_sequence()
returns integer
language plpgsql
as $$
declare next_value integer;
begin
  insert into public.sale_counter (id, current)
  values (1, 1)
  on conflict (id) do update set current = public.sale_counter.current + 1
  returning current into next_value;
  return next_value;
end;
$$;
```

Essa função é chamada automaticamente pelo backend sempre que uma nova venda é criada.

## Rodando localmente

Frontend:
```bash
npm install
npm run dev
```

Backend:
```bash
cd server
npm install
npm run dev
```

## Build de produção

Frontend:
```bash
npm run build        # gera dist/
```

Backend:
```bash
cd server
npm run build        # gera server/dist
npm run start        # usa dist/index.js
```

## Deploy na VPS (Ubuntu 24.04 exemplo)

```bash
# Dependências básicas
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl build-essential ufw

# Node 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2 para gerenciar processos
sudo npm install -g pm2

# Clonar projeto
git clone https://seu-repo.git sonhar-conforto
cd sonhar-conforto

# Front
npm install
cp .env.example .env
echo "VITE_API_URL=https://api.seu-dominio/api" > .env
npm run build

# Backend
cd server
npm install
cp .env.example .env
# configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY vindos do projeto
npm run build

# Start API com PM2
pm2 start dist/index.js --name sonhar-api
pm2 save
pm2 startup systemd   # segue instruções do pm2
```

### Nginx (proxy e front estatico)

```bash
sudo apt install nginx

# /etc/nginx/sites-available/sonhar.conf
server {
  listen 80;
  server_name sonharconforto.com.br www.sonharconforto.com.br;

  root /var/www/sonhar-conforto/dist;
  index index.html;

  location /api/ {
    proxy_pass http://127.0.0.1:3333/;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection 'upgrade';
    proxy_set_header Host $host;
    proxy_cache_bypass $http_upgrade;
  }

  location / {
    try_files $uri $uri/ /index.html;
  }
}

sudo ln -s /etc/nginx/sites-available/sonhar.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Certifique-se de copiar a pasta `dist/` para `/var/www/sonhar-conforto/dist` (ou altere o caminho no `root`). Você pode usar `rsync` ou simples `cp`.

### Pós-deploy

- `pm2 status` para checar a API.
- `journalctl -u nginx -f` para logs do Nginx.
- Acesse `https://sonharconforto.com.br` e faça login com o admin seed para criar novos usuários.

## Scripts úteis

- `npm run build` (front) / `npm run build && npm run start` (server) – builds de produção.
- `pm2 restart sonhar-api` – reinicia backend após atualizar código.

Para provisionar usuários utilize o painel Supabase (Auth) ou os endpoints `/auth/invite` e `/users/*`, sempre mediando pelo backend.

Com isso o projeto fica pronto para ser enviado via git/rsync para a VPS. Basta seguir os comandos acima e garantir que o Supabase esteja configurado com as tabelas e roles necessários.
