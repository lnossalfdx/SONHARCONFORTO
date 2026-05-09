# Deploy VPS

Este guia cobre o fluxo completo:

1. preparar o repositório local;
2. enviar para o git remoto;
3. configurar a VPS;
4. publicar o frontend;
5. subir a API com PM2;
6. configurar Nginx e SSL;
7. atualizar depois.

## 1. Antes de mandar para o git

Arquivos que nao devem ir para o repositório:

- `.env`
- `.env.local`
- `server/.env`
- `dist/`
- `server/dist/`

O `.gitignore` ja foi ajustado para isso, mas como `.env` e `server/.env` ja estavam versionados antes, rode uma vez:

```bash
git rm --cached .env server/.env
```

Depois confira:

```bash
git status
```

Se aparecer apenas removido do indice e continuar existindo no disco, esta certo.

## 2. O que subir para o git

Na sua maquina:

```bash
git add .
git commit -m "chore: prepare app for VPS deploy"
git push origin main
```

Se a branch principal nao for `main`, troque pelo nome certo.

## 3. Estrutura esperada na VPS

Vamos assumir:

- usuario: `root` ou um usuario com sudo
- projeto: `/var/www/sonhar-conforto/current`
- dominio do painel: `resp.sonharconforto.com.br`
- API servida pelo mesmo dominio em `/api`

## 4. Preparar a VPS

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y git curl nginx certbot python3-certbot-nginx
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

Confirme as versoes:

```bash
node -v
npm -v
pm2 -v
```

## 5. Clonar o projeto na VPS

```bash
sudo mkdir -p /var/www/sonhar-conforto
sudo chown -R $USER:$USER /var/www/sonhar-conforto
cd /var/www/sonhar-conforto
git clone SEU_REPOSITORIO_GIT current
cd current
```

Se o repositório ja existir:

```bash
cd /var/www/sonhar-conforto/current
git pull origin main
```

## 6. Configurar os arquivos `.env` na VPS

### Frontend

Crie `/var/www/sonhar-conforto/current/.env`:

```env
VITE_API_URL=/api
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=SUA_CHAVE_ANON
```

### Backend

Crie `/var/www/sonhar-conforto/current/server/.env`:

```env
PORT=3333
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=SUA_CHAVE_ANON
SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE_KEY
CORS_ALLOWED_ORIGINS=https://resp.sonharconforto.com.br,https://sonharconforto.com.br,https://www.sonharconforto.com.br
```

## 7. Instalar dependencias e gerar build

### Banco Supabase

Antes de publicar esta versão, rode no SQL Editor do Supabase o arquivo:

```text
supabase/migrations/20260508_stock_assistance_deploy.sql
```

Ele deixa `assistances.productId` opcional para a assistência não quebrar quando a venda tiver item personalizado.

### Frontend

```bash
cd /var/www/sonhar-conforto/current
npm install
npm run build
```

### Backend

```bash
cd /var/www/sonhar-conforto/current/server
npm install
npm run build
```

## 8. Subir a API com PM2

Na raiz do projeto:

```bash
cd /var/www/sonhar-conforto/current
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd
```

Depois cheque:

```bash
pm2 status
pm2 logs sonhar-conforto-api
curl http://127.0.0.1:3333/health
```

O `curl` deve responder com:

```json
{"status":"ok"}
```

## 9. Configurar Nginx

Copie o exemplo do repositório:

```bash
sudo cp /var/www/sonhar-conforto/current/deploy/nginx/resp.sonharconforto.com.br.conf.example /etc/nginx/sites-available/resp.sonharconforto.com.br
sudo ln -s /etc/nginx/sites-available/resp.sonharconforto.com.br /etc/nginx/sites-enabled/resp.sonharconforto.com.br
sudo nginx -t
sudo systemctl reload nginx
```

Se quiser editar manualmente, o arquivo deve apontar para:

- frontend: `/var/www/sonhar-conforto/current/dist`
- API: `http://127.0.0.1:3333`

## 10. Ativar HTTPS com Certbot

Com o DNS do subdominio ja apontando para a VPS:

```bash
sudo certbot --nginx -d resp.sonharconforto.com.br
```

Confirme a renovacao automatica:

```bash
sudo systemctl status certbot.timer
```

## 11. Testes finais

```bash
curl -I https://resp.sonharconforto.com.br
curl -i https://resp.sonharconforto.com.br/api/auth/me
curl -i -X OPTIONS 'https://resp.sonharconforto.com.br/api/auth/me' \
  -H 'Origin: https://resp.sonharconforto.com.br' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization'
```

No ultimo comando, o esperado e:

- `204 No Content`
- `Access-Control-Allow-Origin: https://resp.sonharconforto.com.br`

## 12. Como atualizar depois

Na sua maquina:

```bash
git add .
git commit -m "feat: sua alteracao"
git push origin main
```

Na VPS:

```bash
cd /var/www/sonhar-conforto/current
git pull origin main
npm install
npm run build
cd server
npm install
npm run build
cd ..
pm2 restart sonhar-conforto-api
sudo systemctl reload nginx
```

## 13. Checklist rapido

- DNS de `resp.sonharconforto.com.br` apontando para a VPS
- `.env` e `server/.env` criados apenas na VPS
- `npm run build` funcionando no front
- `npm run build` funcionando no server
- `pm2 status` mostrando `sonhar-conforto-api` online
- `curl http://127.0.0.1:3333/health` respondendo
- `nginx -t` sem erro
- `certbot` emitido
- login funcionando em `https://resp.sonharconforto.com.br`
