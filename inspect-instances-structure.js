// Ver estrutura da tabela ghl_wa_instances via SQL
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://bfumywvwubvernvhjehk.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdW15d3Z3dWJ2ZXJudmhqZWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTQwMzc5OSwiZXhwIjoyMDY2OTc5Nzk5fQ.fdTsdGlSqemXzrXEU4ov1SUpeDn_3bSjOingqkSAWQE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function getTableStructure() {
  console.log('🔍 Obtendo estrutura da tabela ghl_wa_instances...\n');

  // Tentar inserir um registro de teste para ver quais colunas aceita
  const testData = {
    instance_id: 'test-123',
    phone_number: '+5511999999999',
  };

  const { error } = await supabase
    .from('ghl_wa_instances')
    .insert(testData);

  if (error) {
    console.log('⚠️  Erro ao inserir teste:', error.message);
    console.log('   Detalhes:', error.details);
    console.log('   Hint:', error.hint);
  } else {
    console.log('✅ Teste inserido com sucesso!');
    console.log('   Colunas aceitas:', Object.keys(testData));

    // Deletar o registro de teste
    await supabase
      .from('ghl_wa_instances')
      .delete()
      .eq('instance_id', 'test-123');
    console.log('   Registro de teste removido.\n');
  }
}

getTableStructure().catch(console.error);
