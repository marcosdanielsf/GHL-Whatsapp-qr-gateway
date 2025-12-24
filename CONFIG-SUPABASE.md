# ✅ WhatsApp Gateway - Configuração Supabase

## 🎉 CONVERSÃO COMPLETA: Redis → Supabase

O projeto foi convertido com sucesso de Redis para Supabase!

---

## 📝 VARIÁVEIS DE AMBIENTE

Adicione estas variáveis ao seu arquivo `.env`:

```bash
# Supabase CEO (substitui Redis)
SUPABASE_URL=https://bfumywvwubvernvhjehk.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdW15d3Z3dWJ2ZXJudmhqZWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTQwMzc5OSwiZXhwIjoyMDY2OTc5Nzk5fQ.fdTsdGlSqemXzrXEU4ov1SUpeDn_3bSjOingqkSAWQE

# Porta
PORT=8080

# GHL OAuth
GHL_CLIENT_ID=674b8def93a5ee7af05f1bda-upd5eqzf
GHL_CLIENT_SECRET=3f37419d-ee34-403c-a1c8-e35febe6c625
GHL_REDIRECT_URI=https://your-app.railway.app/api/auth/callback
GHL_INBOUND_URL=https://your-ghl-inbound.example/webhook

# Sessões Baileys
SESSION_DIR=./data/sessions

# Delays
TEXT_DELAY_MS=3500
MEDIA_DELAY_MS_MIN=6000
MEDIA_DELAY_MS_MAX=9000

# CORS
CORS_ORIGIN=http://localhost:5173,http://127.0.0.1:5173
```

---

## ✅ TABELAS CRIADAS NO SUPABASE

> **📖 Documentação Completa:** Veja [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) para detalhes de colunas, tipos e relacionamentos.

Todas as tabelas foram criadas no Supabase CEO:

- ✅ `ghl_wa_queue` - Fila de mensagens (substitui Bull Queue)
- ✅ `ghl_wa_pending_messages` - Mensagens pendentes
- ✅ `ghl_wa_sessions` - Sessões Baileys (WhatsApp)
- ✅ `ghl_wa_cache` - Cache com TTL (substitui Redis)
- ✅ `ghl_wa_instances` - Instâncias ativas (já existia)
- ✅ `ghl_wa_message_queue` - Fila principal (já existia)

---

## 🔄 MUDANÇAS NO CÓDIGO

### Arquivos Modificados:
1. **src/infra/supabaseClient.ts** (NOVO)
   - Cliente Supabase centralizado
   - Funções helper para cache e estatísticas

2. **src/infra/instanceNumbersCache.ts** (NOVO)
   - Gerenciamento de números de instâncias
   - Substitui Redis hash `instances:numbers`

3. **src/core/pendingMessages.ts** (ATUALIZADO)
   - Usa `ghl_wa_pending_messages` do Supabase
   - Todas as funções mantiveram a mesma interface

4. **src/core/baileys.ts** (ATUALIZADO)
   - Usa novas funções de cache do Supabase
   - Removeu import de `redisClient`

5. **src/api/qr.controller.ts** (ATUALIZADO)
   - Endpoint `/cleanup-redis` → `/cleanup-cache`
   - Usa Supabase para limpar registros órfãos

6. **package.json** (ATUALIZADO)
   - Removido: `ioredis`
   - Mantido: `@supabase/supabase-js`

### Arquivos Removidos (backup):
- `src/infra/redisClient.ts` → `redisClient.ts.backup`
- `src/core/pendingMessages.redis-backup.ts` → `.bak`

---

## 🚀 DEPLOY NO RAILWAY

### 1. Conectar repositório

No Railway Dashboard:
1. New Project → GitHub Repository
2. Selecione `GHL-Whatsapp-qr-gateway`

### 2. Configurar variáveis de ambiente

Adicione todas as variáveis acima no Railway (Settings → Variables)

**NÃO PRECISA DE REDIS!** 🎉

### 3. Deploy automático

Railway vai:
- Rodar `npm install`
- Rodar `npm run build`
- Rodar `npm start`

### 4. Atualizar URLs após deploy

Depois do primeiro deploy, pegue a URL do Railway e atualize:
```bash
GHL_REDIRECT_URI=https://seu-app.railway.app/api/auth/callback
GHL_INBOUND_URL=https://seu-app.railway.app/api/webhook/inbound
```

---

## 🧪 TESTAR LOCALMENTE

```bash
# 1. Configurar .env
cp .env.example .env
# (edite o .env com suas credenciais)

# 2. Instalar dependências
npm install

# 3. Build
npm run build

# 4. Rodar
npm start
```

**Teste o health check:**
```bash
curl http://localhost:8080/health
# Deve retornar: {"status":"ok"}
```

---

## 📊 ENDPOINTS ATUALIZADOS

- ❌ `POST /api/wa/cleanup-redis` (REMOVIDO)
- ✅ `POST /api/wa/cleanup-cache` (NOVO - limpa Supabase)

Todos os outros endpoints permanecem iguais!

---

## 🔍 MONITORAMENTO

Ver estatísticas da fila:
```bash
curl http://localhost:8080/api/queue/stats
```

Ver mensagens pendentes:
```bash
curl http://localhost:8080/api/pending/summary
```

---

## ⚡ PERFORMANCE

**Benefícios vs Redis:**
- ✅ Menos dependências (sem Redis server)
- ✅ Custo reduzido (Railway não precisa de serviço Redis)
- ✅ Dados persistentes (PostgreSQL nativo)
- ✅ Mais fácil de debugar (SQL queries)
- ✅ Backup automático (Supabase)

**Trade-offs:**
- ⚠️  Latência ligeiramente maior (PostgreSQL vs Redis)
- ⚠️  Verificar limits do Supabase free tier

---

## 🆘 TROUBLESHOOTING

**Erro: "SUPABASE_URL not found"**
- Verifique se o .env está configurado
- Railway: Settings → Variables

**Erro: "Table does not exist"**
- Rode o SQL `supabase-ghl-wa-schema.sql` no dashboard
- URL: https://supabase.com/dashboard/project/bfumywvwubvernvhjehk/sql

**Build falha com "ioredis not found"**
- Não deveria acontecer (removemos ioredis)
- Se acontecer: `rm -rf node_modules && npm install`

---

✅ **PRONTO PARA DEPLOY!**
