# Sonhar Conforto API

Backend em Node.js/Express utilizando o Supabase (PostgreSQL gerenciado + Auth) como camada de dados única.

## Requisitos

- Node.js 20+
- Projeto Supabase ativo com chaves `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`.

## Configuração

1. Copie `.env.example` para `.env` e ajuste `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` e `PORT`.
2. Instale as dependências:

```bash
cd server
npm install
```

3. Inicie o servidor em modo desenvolvimento:

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

Autenticação usa Supabase Auth (token enviado pelo frontend). O middleware `authMiddleware` valida o JWT do Supabase e carrega os dados do usuário antes de passar o controle para as rotas. O `roleGuard` restringe o acesso por perfil (`admin` ou `seller`).

## Deploy na VPS Ubuntu 24.04

1. Instale Node.js LTS (via nvm) e configure o projeto Supabase (tabelas + policies).
2. Clone o repositório no servidor e configure variáveis `.env` com os valores de produção.
3. Execute `npm install --production` e `npm run build` na pasta `server`.
4. Suba o processo com um gerenciador como PM2 ou systemd:

```bash
pm2 start dist/index.js --name sonhar-api
```

5. Configure Nginx (ou outro proxy) para expor `localhost:3333` em HTTPS.

A partir daí, o front-end pode consumir os endpoints expostos em `/api/*`, enquanto o Supabase continua sendo a única base de dados/autenticação.
