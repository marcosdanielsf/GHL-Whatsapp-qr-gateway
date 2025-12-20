// Verificar tabelas do WhatsApp Gateway no Supabase CEO
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bfumywvwubvernvhjehk.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdW15d3Z3dWJ2ZXJudmhqZWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTQwMzc5OSwiZXhwIjoyMDY2OTc5Nzk5fQ.fdTsdGlSqemXzrXEU4ov1SUpeDn_3bSjOingqkSAWQE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Tabelas necessárias para o WhatsApp Gateway
const requiredTables = [
  'whatsapp_queue',
  'whatsapp_pending_messages',
  'whatsapp_sessions',
  'whatsapp_cache'
];

async function checkTables() {
  console.log('🔍 Verificando tabelas do WhatsApp Gateway no Supabase CEO...\n');

  const existing = [];
  const missing = [];

  for (const table of requiredTables) {
    const { error } = await supabase
      .from(table)
      .select('count')
      .limit(0);

    if (error && error.message.includes('does not exist')) {
      missing.push(table);
      console.log(`❌ ${table} - FALTANDO`);
    } else if (error) {
      console.log(`⚠️  ${table} - ERRO: ${error.message}`);
    } else {
      existing.push(table);
      console.log(`✅ ${table} - JÁ EXISTE`);
    }
  }

  console.log(`\n📊 RESUMO:`);
  console.log(`✅ Existentes: ${existing.length}/${requiredTables.length}`);
  console.log(`❌ Faltando: ${missing.length}/${requiredTables.length}`);

  if (missing.length > 0) {
    console.log(`\n⚠️  TABELAS A CRIAR:`);
    missing.forEach(t => console.log(`   - ${t}`));
  } else {
    console.log(`\n🎉 TODAS AS TABELAS JÁ EXISTEM! Podemos usar direto.`);
  }
}

checkTables().catch(console.error);
