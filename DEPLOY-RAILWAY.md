# Deploy WhatsApp Gateway no Railway

## 🚀 MIGRAÇÃO SUPABASE (Atualizado)

Este projeto foi atualizado para usar **Supabase** em vez de Redis para maior persistência e economia.

### 1. Na interface do Railway:

**Se já tem o projeto:**
1. Vá nas configurações do serviço.
2. **Remova** o serviço Redis (não precisamos mais dele!).
3. Atualize as variáveis de ambiente (veja abaixo).

**Se for criar do zero:**
1. New Project → GitHub Repository
2. Selecione: `GHL-Whatsapp-qr-gateway`

### 2. Configure as variáveis de ambiente:

Vá em "Variables" e adicione/atualize:

```bash
# Supabase (Essenciais)
SUPABASE_URL=https://bfumywvwubvernvhjehk.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdW15d3Z3dWJ2ZXJudmhqZWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTQwMzc5OSwiZXhwIjoyMDY2OTc5Nzk5fQ.fdTsdGlSqemXzrXEU4ov1SUpeDn_3bSjOingqkSAWQE

# GHL OAuth
GHL_CLIENT_ID=674b8def93a5ee7af05f1bda-upd5eqzf
GHL_CLIENT_SECRET=3f37419d-ee34-403c-a1c8-e35febe6c625
GHL_REDIRECT_URI=https://seu-app.railway.app/api/auth/callback
GHL_INBOUND_URL=https://seu-app.railway.app/api/webhook/inbound

# Configurações Gerais
PORT=8080
SESSION_DIR=./data/sessions
TEXT_DELAY_MS=3500
MEDIA_DELAY_MS_MIN=6000
MEDIA_DELAY_MS_MAX=9000
```

> **Nota:** Remova qualquer variável `REDIS_URL` antiga.

### 3. Deploy

- O Railway vai detectar o push no GitHub e fazer o deploy automático.
- O novo código usa Supabase para filas e cache.

### 4. Atualizar URLs

Depois do deploy, pegue a URL pública do Railway (ex: `https://web-production-1234.up.railway.app`) e atualize as variáveis `GHL_REDIRECT_URI` e `GHL_INBOUND_URL`.

---

## ✅ CHECKLIST

- [ ] Variáveis SUPABASE configuradas
- [ ] Variáveis REDIS removidas
- [ ] Build passou (verde)
- [ ] `/health` retorna OK

