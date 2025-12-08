# Sonhar Conforto API

Backend em Node.js/Express + Prisma/PostgreSQL para alimentar o front-end React do CRM.

## Requisitos

- Node.js 18+
- PostgreSQL 14+ (local ou hospedado) — em desenvolvimento você pode usar `docker compose` (ver abaixo)

## Configuração

1. Copie `.env.example` para `.env` e ajuste `DATABASE_URL`, `JWT_SECRET` e `PORT`.
2. Instale as dependências:

```bash
cd server
npm install
```

3. Gere o cliente Prisma e rode as migrações:

```bash
npm run prisma:migrate
```

4. (Opcional) Popule o primeiro usuário administrador:

```bash
npm run prisma:seed
```

5. Inicie o servidor em modo desenvolvimento:

```bash
npm run dev
```

A API ficará disponível em `http://localhost:3333` (ou porta configurada).

## Estrutura principal

- `src/routes/auth.routes.ts` – login e convites de usuário
- `src/routes/users.routes.ts` – administração de contas (apenas admin)
- `src/routes/clients.routes.ts` – CRUD completo de clientes
- `src/routes/stock.routes.ts` – catálogo e movimentações de estoque (visualização livre, mutações só admin)
- `src/routes/sales.routes.ts` – vendas Sleep Lab, itens, pagamentos e confirmação de entregas
- `src/routes/assistances.routes.ts` – abertura e acompanhamento de assistências/garantias
- `src/routes/finance.routes.ts` – KPIs financeiros consolidados (apenas admin)

Autenticação usa JWT (12h) e o middleware `authMiddleware`. O `roleGuard` restringe rotas por perfil (`admin` ou `seller`). Senhas são hashadas com bcrypt.

## Rodando PostgreSQL local via Docker

```bash
docker run -d --name sonhar-postgres \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=sonhar_conforto \
  -p 5432:5432 postgres:16
```

Atualize `DATABASE_URL` para apontar para essa instância.

## Deploy na VPS Ubuntu 24.04

1. Instale Node.js LTS (via nvm) e PostgreSQL ou use um serviço gerenciado.
2. Clone o repositório no servidor e configure variáveis `.env` com os valores de produção.
3. Execute `npm install --production`, `npm run prisma:migrate` e `npm run build` na pasta `server`.
4. Suba o processo com um gerenciador como PM2 ou systemd:

```bash
pm2 start dist/index.js --name sonhar-api
```

5. Configure Nginx (ou outro proxy) para expor `localhost:3333` em HTTPS.

A partir daí, o front-end pode consumir os endpoints expostos em `/api/*`.
