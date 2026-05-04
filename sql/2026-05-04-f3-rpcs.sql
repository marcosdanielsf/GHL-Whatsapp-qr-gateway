-- 2026-05-04 BRT — F3 RPCs auxiliares
-- Pedido pelo backend agent: upsert/get encrypted AI key + atomic counter increment

-- 1. upsert_tenant_ai_key — pgp_sym_encrypt + upsert
CREATE OR REPLACE FUNCTION public.upsert_tenant_ai_key(
  p_tenant_id uuid,
  p_provider text,
  p_api_key text,
  p_model text,
  p_passphrase text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO public.tenant_ai_keys (tenant_id, provider, api_key_encrypted, model)
  VALUES (p_tenant_id, p_provider, pgp_sym_encrypt(p_api_key, p_passphrase), p_model)
  ON CONFLICT (tenant_id, provider) DO UPDATE
    SET api_key_encrypted = pgp_sym_encrypt(p_api_key, p_passphrase),
        model = p_model,
        updated_at = NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 2. get_tenant_ai_key — pgp_sym_decrypt + retorna api_key + model
CREATE OR REPLACE FUNCTION public.get_tenant_ai_key(
  p_tenant_id uuid,
  p_provider text,
  p_passphrase text
) RETURNS TABLE(api_key text, model text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT pgp_sym_decrypt(t.api_key_encrypted, p_passphrase)::text AS api_key,
           t.model
    FROM public.tenant_ai_keys t
    WHERE t.tenant_id = p_tenant_id AND t.provider = p_provider
    LIMIT 1;
END;
$$;

-- 3. increment_campaign_counter — atomic increment de sent_count/failed_count/replied_count
CREATE OR REPLACE FUNCTION public.increment_campaign_counter(
  p_campaign_id uuid,
  p_field text
) RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_new int;
BEGIN
  IF p_field NOT IN ('sent_count','failed_count','replied_count') THEN
    RAISE EXCEPTION 'invalid field: %', p_field;
  END IF;
  EXECUTE format('UPDATE public.campaigns SET %I = COALESCE(%I,0)+1 WHERE id=$1 RETURNING %I', p_field, p_field, p_field)
    INTO v_new USING p_campaign_id;
  RETURN v_new;
END;
$$;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.upsert_tenant_ai_key(uuid, text, text, text, text);
-- DROP FUNCTION IF EXISTS public.get_tenant_ai_key(uuid, text, text);
-- DROP FUNCTION IF EXISTS public.increment_campaign_counter(uuid, text);
