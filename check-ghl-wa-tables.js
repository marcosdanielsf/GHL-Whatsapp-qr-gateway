// Verificar tabelas ghl_wa* no Supabase CEO
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bfumywvwubvernvhjehk.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdW15d3Z3dWJ2ZXJudmhqZWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTQwMzc5OSwiZXhwIjoyMDY2OTc5Nzk5fQ.fdTsdGlSqemXzrXEU4ov1SUpeDn_3bSjOingqkSAWQE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Possíveis tabelas com prefixo ghl_wa
const possibleTables = [
  'ghl_wa_queue',
  'ghl_wa_pending_messages',
  'ghl_wa_sessions',
  'ghl_wa_cache',
  'ghl_wa_messages',
  'ghl_wa_instances',
  'ghl_whatsapp_queue',
  'ghl_whatsapp_sessions',
  'ghl_whatsapp_cache',
  'ghl_whatsapp_messages'
];

async function checkGHLTables() {
  console.log('🔍 Verificando tabelas ghl_wa* no Supabase CEO...\n');

  const existing = [];
  const missing = [];

  for (const table of possibleTables) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .limit(1);

    if (error && error.message.includes('does not exist')) {
      missing.push(table);
      console.log(`❌ ${table} - NÃO EXISTE`);
    } else if (error) {
      console.log(`⚠️  ${table} - ERRO: ${error.message}`);
    } else {
      existing.push(table);
      console.log(`✅ ${table} - EXISTE`);

      // Mostrar estrutura da tabela
      if (data && data.length > 0) {
        const columns = Object.keys(data[0]);
        console.log(`   Colunas: ${columns.join(', ')}`);
      }
    }
  }

  console.log(`\n📊 RESUMO:`);
  console.log(`✅ Existentes: ${existing.length}`);
  console.log(`❌ Não existem: ${missing.length}`);

  if (existing.length > 0) {
    console.log(`\n🎉 TABELAS ENCONTRADAS:`);
    existing.forEach(t => console.log(`   ✅ ${t}`));
    console.log(`\n💡 Vou usar essas tabelas existentes ao invés de criar novas!`);
  }
}

checkGHLTables().catch(console.error);
