# Sonhar Conforto CRM

Aplicação completa (frontend Vite + backend Node/Express + Postgres via Prisma) para operação do CRM Sonhar Conforto: pipeline de vendas, estoque, clientes, assistências, entregas e financeiro.

## Requisitos

- Node.js 20+
- npm 10+
- PostgreSQL 16 (ou container Docker compatível)

## Estrutura

```
.
├── server        # API (Express + Prisma)
├── src           # Frontend React/Vite
├── public        # Assets do front
├── dist          # Build do front (gerado)
└── README.md
```

## Variáveis de ambiente

- Frontend: `.env.local` (ou `.env`) – exemplo em `.env.example`
  ```
  VITE_API_URL=https://seu-dominio/api
  ```

- Backend: `server/.env` – exemplo em `server/.env.example`
  ```
  DATABASE_URL="postgresql://USER:PASS@HOST:PORT/sonhar_conforto?schema=public"
  JWT_SECRET="chave-bem-grande"
  PORT=3333
  ```

## Banco de dados

```bash
cd server
# cria tabelas
npm run prisma:migrate
# gera seed com usuário admin (kemimarcondesblaze@gmail.com / Kema3030!)
npm run prisma:seed
```

Para ambiente local você pode usar Docker:

```bash
docker run -d --name sonhar-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=sonhar_conforto \
  -p 6543:5432 postgres:16

# .env deve apontar para porta 6543
DATABASE_URL="postgresql://postgres:postgres@localhost:6543/sonhar_conforto?schema=public"
```

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
# editar .env com URL do Postgres e JWT_SECRET forte
npm run prisma:migrate
npm run prisma:seed
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

- `npm run prisma:migrate` / `:seed` – manter schema sincronizado.
- `npm run build` (front) / `npm run build && npm run start` (server) – builds de produção.
- `pm2 restart sonhar-api` – reinicia backend após atualizar código.

## Suporte rápido

- Usuário admin seed: `kemimarcondesblaze@gmail.com` / `Kema3030!`
- Troque a senha no banco assim que subir em produção!

Com isso o projeto fica pronto para ser enviado via git/rsync para a VPS. Basta seguir os comandos acima que o domínio apontado já serve o front + API.
