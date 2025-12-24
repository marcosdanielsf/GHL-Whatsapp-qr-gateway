// Verificar se ghl_wa_message_queue existe
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bfumywvwubvernvhjehk.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdW15d3Z3dWJ2ZXJudmhqZWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTQwMzc5OSwiZXhwIjoyMDY2OTc5Nzk5fQ.fdTsdGlSqemXzrXEU4ov1SUpeDn_3bSjOingqkSAWQE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkTable() {
  console.log('🔍 Verificando ghl_wa_message_queue...\n');

  const { data, error } = await supabase
    .from('ghl_wa_message_queue')
    .select('*')
    .limit(1);

  if (error && error.message.includes('does not exist')) {
    console.log('❌ ghl_wa_message_queue NÃO EXISTE');
    console.log('💡 Código usa ghl_wa_message_queue mas tabela não existe.');
    console.log('   Opções:');
    console.log('   1. Renomear ghl_wa_queue para ghl_wa_message_queue');
    console.log('   2. Atualizar código para usar ghl_wa_queue\n');
  } else if (error) {
    console.log('⚠️  Erro:', error.message);
  } else {
    console.log('✅ ghl_wa_message_queue EXISTE!');
    if (data && data.length > 0) {
      console.log('   Colunas:', Object.keys(data[0]).join(', '));
    }
  }
}

checkTable().catch(console.error);
