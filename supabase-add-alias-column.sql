-- Atualização da tabela ghl_wa_instances para incluir coluna alias (se não existir)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'ghl_wa_instances'
        AND column_name = 'alias'
    ) THEN
        ALTER TABLE ghl_wa_instances ADD COLUMN alias TEXT;
        RAISE NOTICE 'Coluna alias adicionada à tabela ghl_wa_instances';
    ELSE
        RAISE NOTICE 'Coluna alias já existe na tabela ghl_wa_instances';
    END IF;
END $$;

-- Recarregar cache do esquema para garantir que o PostgREST veja a nova coluna
NOTIFY pgrst, 'reload config';
