-- 2026-05-04 BRT — F8 RPC atomic increment de tokens em ai_conversations
CREATE OR REPLACE FUNCTION public.increment_conversation_tokens(
  p_conversation_id uuid,
  p_tokens_input int,
  p_tokens_output int,
  p_history_messages jsonb,
  p_history_summary text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.ai_conversations
  SET total_tokens_input = COALESCE(total_tokens_input, 0) + p_tokens_input,
      total_tokens_output = COALESCE(total_tokens_output, 0) + p_tokens_output,
      history_messages = p_history_messages,
      history_summary = COALESCE(p_history_summary, history_summary),
      last_response_at = NOW()
  WHERE id = p_conversation_id;
END;
$$;

-- ROLLBACK:
-- DROP FUNCTION IF EXISTS public.increment_conversation_tokens(uuid, int, int, jsonb, text);
