-- Migration: WhatsApp Cloud API Routing
-- Tabela para rotear mensagens entre Baileys (nao-oficial) e Cloud API (oficial Meta)
-- Supabase: bfumywvwubvernvhjehk
-- Data: 2026-03-06

-- Tabela de roteamento: cada numero de cliente tem sua config
CREATE TABLE IF NOT EXISTS whatsapp_routing (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    location_id TEXT NOT NULL,
    phone_number TEXT NOT NULL,           -- numero do cliente ex: +5511999999999
    phone_number_id TEXT,                 -- Phone Number ID da Meta (null = Baileys)
    waba_id TEXT,                         -- WhatsApp Business Account ID da Meta
    display_name TEXT,                    -- nome exibido no WhatsApp (ex: "Dra. Gabriella - Clinica")
    access_token TEXT,                    -- Permanent Token Meta (criptografado)
    n8n_webhook_url TEXT,                 -- URL do webhook n8n pra esse cliente
    is_cloud_api BOOLEAN DEFAULT false,   -- false = Baileys, true = Cloud API
    is_active BOOLEAN DEFAULT true,
    meta_verify_token TEXT,               -- Token de verificacao do webhook Meta
    meta_app_secret TEXT,                 -- App Secret pra validar HMAC-SHA256
    last_message_at TIMESTAMPTZ,          -- ultima mensagem recebida/enviada
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    -- UNIQUE parcial: so valida quando phone_number nao e vazio
    -- (clientes no Baileys podem nao ter phone_number preenchido ainda)
    CONSTRAINT uq_whatsapp_routing_phone_number_id UNIQUE (phone_number_id)
);

-- UNIQUE parcial: so valida phone_number nao-vazio (Baileys pode nao ter preenchido)
CREATE UNIQUE INDEX IF NOT EXISTS idx_whatsapp_routing_phone_nonempty
    ON whatsapp_routing (phone_number) WHERE phone_number != '';

-- Indice pra lookup rapido por phone_number_id (webhook Meta envia esse campo)
CREATE INDEX IF NOT EXISTS idx_whatsapp_routing_phone_number_id
    ON whatsapp_routing (phone_number_id) WHERE phone_number_id IS NOT NULL;

-- Indice pra lookup por location_id
CREATE INDEX IF NOT EXISTS idx_whatsapp_routing_location_id
    ON whatsapp_routing (location_id);

-- RLS
ALTER TABLE whatsapp_routing ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_routing FORCE ROW LEVEL SECURITY;

-- Policy: service_role pode tudo (gateway usa service role key)
CREATE POLICY "service_role_full_access" ON whatsapp_routing
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_whatsapp_routing_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_whatsapp_routing_updated_at
    BEFORE UPDATE ON whatsapp_routing
    FOR EACH ROW
    EXECUTE FUNCTION update_whatsapp_routing_updated_at();

-- Tabela de templates HSM aprovados
CREATE TABLE IF NOT EXISTS whatsapp_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    waba_id TEXT NOT NULL,
    template_name TEXT NOT NULL,
    language TEXT NOT NULL DEFAULT 'pt_BR',
    category TEXT NOT NULL CHECK (category IN ('MARKETING', 'UTILITY', 'AUTHENTICATION')),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    header_text TEXT,
    body_text TEXT NOT NULL,               -- texto com {{1}}, {{2}}, etc.
    footer_text TEXT,
    buttons JSONB,                         -- botoes CTA/quick-reply
    meta_template_id TEXT,                 -- ID retornado pela Meta apos aprovacao
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),

    CONSTRAINT uq_whatsapp_templates_name_lang UNIQUE (waba_id, template_name, language)
);

ALTER TABLE whatsapp_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_templates FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON whatsapp_templates
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Tabela de log de mensagens Cloud API (tracking de custos e status)
CREATE TABLE IF NOT EXISTS whatsapp_cloud_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    routing_id UUID REFERENCES whatsapp_routing(id),
    wamid TEXT,                            -- message ID retornado pela Meta (wamid.xxx)
    direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    message_type TEXT NOT NULL DEFAULT 'text',  -- text, template, image, document, etc
    template_name TEXT,                    -- nome do template (se outbound template)
    contact_phone TEXT NOT NULL,           -- numero do lead
    content TEXT,                          -- conteudo da mensagem
    status TEXT DEFAULT 'sent' CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
    conversation_id TEXT,                  -- ID da conversa Meta (pra tracking de custo)
    conversation_category TEXT,            -- service, marketing, utility, authentication
    error_code TEXT,
    error_message TEXT,
    metadata JSONB,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_cloud_messages_wamid
    ON whatsapp_cloud_messages (wamid) WHERE wamid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_whatsapp_cloud_messages_routing
    ON whatsapp_cloud_messages (routing_id, created_at DESC);

ALTER TABLE whatsapp_cloud_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_cloud_messages FORCE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access" ON whatsapp_cloud_messages
    FOR ALL
    USING (auth.role() = 'service_role')
    WITH CHECK (auth.role() = 'service_role');

-- Inserir rotas dos clientes atuais (todos comecam no Baileys)
INSERT INTO whatsapp_routing (location_id, phone_number, is_cloud_api, display_name) VALUES
    ('xliub5H5pQ4QcDeKHc6F', '', false, 'Dra. Gabriella Rossmann'),
    ('EKHxHl3KLPN0iRc69GNU', '', false, 'Fernanda Lappe'),
    ('8GedMLMaF26jIkHq50XG', '', false, 'Flavia Leal'),
    ('uSwkCg4V1rfpvk4tG6zP', '', false, 'Heloise Silvestre'),
    ('sNwLyynZWP6jEtBy1ubf', '', false, 'Luiz Augusto'),
    ('Bgi2hFMgiLLoRlOO0K5b', '', false, 'Marina Couto'),
    ('Rre0WqSlmAPmIrURgiMf', '', false, 'Thauan Santos'),
    ('mfOxMOpk3DoQXRB47MgS', '', false, 'Dra. Carolina Simonatto'),
    ('x7XafRxWaLa0EheQcaGS', '', false, 'Jarbas Teixeira')
ON CONFLICT DO NOTHING;

-- ROLLBACK (caso precise reverter)
-- DROP TABLE IF EXISTS whatsapp_cloud_messages;
-- DROP TABLE IF EXISTS whatsapp_templates;
-- DROP TABLE IF EXISTS whatsapp_routing;
-- DROP FUNCTION IF EXISTS update_whatsapp_routing_updated_at();
