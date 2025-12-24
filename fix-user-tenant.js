const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bfumywvwubvernvhjehk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdW15d3Z3dWJ2ZXJudmhqZWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTQwMzc5OSwiZXhwIjoyMDY2OTc5Nzk5fQ.fdTsdGlSqemXzrXEU4ov1SUpeDn_3bSjOingqkSAWQE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function fixUserTenant() {
  console.log('🔗 Associando usuário ao tenant...\n');

  const userId = '5d8cc979-387a-49ce-aac8-03875cfc1012';
  const tenantId = 'e496ec12-078c-4003-b42f-d15df61bc4b7';

  const { data, error } = await supabase
    .from('ghl_wa_users')
    .update({ tenant_id: tenantId })
    .eq('id', userId)
    .select();

  if (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }

  console.log('✅ Usuário associado com sucesso!');
  console.log('\n🎉 PRONTO!');
  console.log(`
- User ID: ${userId}
- Tenant ID: ${tenantId}

🌐 Acesse: https://nexus.socialfy.me
💡 Faça refresh com Ctrl+Shift+R
  `);
}

fixUserTenant();
