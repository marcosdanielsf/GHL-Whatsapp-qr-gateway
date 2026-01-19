-- ============================================
-- UPGRADE: GHL Integration Custom Provider Support
-- Data: 2026-01-19
-- Descrição: Adiciona campos necessários para Custom Conversation Provider
-- ============================================

-- 1. Adicionar campo conversation_provider_id na tabela de integrações
ALTER TABLE ghl_wa_integrations
ADD COLUMN IF NOT EXISTS conversation_provider_id TEXT;

-- 2. Adicionar campo is_active para controle de integrações
ALTER TABLE ghl_wa_integrations
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 3. Adicionar campo ghl_integration_id na tabela de instâncias (link direto)
ALTER TABLE ghl_wa_instances
ADD COLUMN IF NOT EXISTS ghl_integration_id UUID REFERENCES ghl_wa_integrations(id);

-- 4. Criar índice para busca por location_id
CREATE INDEX IF NOT EXISTS idx_ghl_wa_integrations_location
ON ghl_wa_integrations(location_id);

-- 5. Criar índice para busca por integration_id nas instâncias
CREATE INDEX IF NOT EXISTS idx_ghl_wa_instances_integration
ON ghl_wa_instances(ghl_integration_id);

-- 6. Tabela para armazenar mapeamento de mensagens GHL ↔ WhatsApp
-- Útil para atualizar status de mensagens
CREATE TABLE IF NOT EXISTS ghl_wa_message_mapping (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  integration_id UUID REFERENCES ghl_wa_integrations(id) ON DELETE CASCADE,
  ghl_message_id TEXT NOT NULL,
  wa_message_id TEXT,
  ghl_contact_id TEXT NOT NULL,
  phone TEXT NOT NULL,
  direction TEXT NOT NULL, -- 'inbound' ou 'outbound'
  status TEXT DEFAULT 'pending', -- pending, sent, delivered, read, failed
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_message_mapping_ghl_id
ON ghl_wa_message_mapping(ghl_message_id);

CREATE INDEX IF NOT EXISTS idx_ghl_wa_message_mapping_wa_id
ON ghl_wa_message_mapping(wa_message_id);

-- Trigger para updated_at
DROP TRIGGER IF EXISTS update_ghl_wa_message_mapping_updated_at ON ghl_wa_message_mapping;
CREATE TRIGGER update_ghl_wa_message_mapping_updated_at
  BEFORE UPDATE ON ghl_wa_message_mapping
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- RLS
ALTER TABLE ghl_wa_message_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role has full access to ghl_wa_message_mapping" ON ghl_wa_message_mapping
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON ghl_wa_message_mapping TO service_role;

-- 7. Comentários
COMMENT ON COLUMN ghl_wa_integrations.conversation_provider_id IS 'ID do Custom Conversation Provider no GHL Marketplace';
COMMENT ON COLUMN ghl_wa_integrations.is_active IS 'Indica se a integração está ativa';
COMMENT ON COLUMN ghl_wa_instances.ghl_integration_id IS 'Referência direta à integração GHL desta instância';
COMMENT ON TABLE ghl_wa_message_mapping IS 'Mapeamento entre mensagens do GHL e WhatsApp para tracking de status';

-- ============================================
-- FIM DA MIGRATION
-- ============================================
