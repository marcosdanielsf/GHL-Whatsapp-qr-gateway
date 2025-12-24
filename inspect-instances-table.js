// Inspecionar a tabela ghl_wa_instances
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bfumywvwubvernvhjehk.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdW15d3Z3dWJ2ZXJudmhqZWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTQwMzc5OSwiZXhwIjoyMDY2OTc5Nzk5fQ.fdTsdGlSqemXzrXEU4ov1SUpeDn_3bSjOingqkSAWQE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function inspectInstances() {
  console.log('🔍 Inspecionando tabela ghl_wa_instances...\n');

  const { data, error } = await supabase
    .from('ghl_wa_instances')
    .select('*')
    .limit(5);

  if (error) {
    console.log('❌ Erro:', error.message);
    return;
  }

  console.log(`📊 Registros encontrados: ${data.length}\n`);

  if (data.length > 0) {
    console.log('📋 ESTRUTURA DA TABELA:');
    const firstRow = data[0];
    Object.keys(firstRow).forEach(col => {
      const value = firstRow[col];
      const type = typeof value;
      console.log(`   - ${col}: ${type} ${value === null ? '(null)' : ''}`);
    });

    console.log('\n💾 DADOS DE EXEMPLO:');
    data.forEach((row, idx) => {
      console.log(`\n   Registro ${idx + 1}:`);
      Object.entries(row).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null) {
          console.log(`      ${key}: ${JSON.stringify(value).substring(0, 100)}...`);
        } else {
          console.log(`      ${key}: ${value}`);
        }
      });
    });
  } else {
    console.log('⚠️  Tabela existe mas está vazia.');
    console.log('\n💡 Vou verificar a estrutura via query SQL...');
  }

  // Contar registros
  const { count, error: countError } = await supabase
    .from('ghl_wa_instances')
    .select('*', { count: 'exact', head: true });

  if (!countError) {
    console.log(`\n📈 Total de registros na tabela: ${count || 0}`);
  }
}

inspectInstances().catch(console.error);
