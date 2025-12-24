const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://bfumywvwubvernvhjehk.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdW15d3Z3dWJ2ZXJudmhqZWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTQwMzc5OSwiZXhwIjoyMDY2OTc5Nzk5fQ.fdTsdGlSqemXzrXEU4ov1SUpeDn_3bSjOingqkSAWQE';

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupTenant() {
  console.log('🚀 Configurando tenant...\n');

  try {
    // Passo 1: Criar tenant
    console.log('📝 Criando tenant "Socialfy"...');
    const { data: tenant, error: tenantError } = await supabase
      .from('ghl_wa_tenants')
      .insert({
        name: 'Socialfy',
        slug: 'socialfy',
        subscription_status: 'active',
        subscription_plan: 'professional',
        max_instances: 10,
        trial_ends_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      })
      .select()
      .single();

    if (tenantError) {
      console.error('❌ Erro ao criar tenant:', tenantError.message);
      process.exit(1);
    }

    console.log('✅ Tenant criado:', tenant.id);

    // Passo 2: Buscar usuário
    console.log('\n🔍 Buscando seu usuário...');
    const { data: users, error: userError } = await supabase
      .from('ghl_wa_users')
      .select('*')
      .limit(1);

    if (userError || !users || users.length === 0) {
      console.error('❌ Nenhum usuário encontrado');
      process.exit(1);
    }

    const userId = users[0].id;
    console.log('✅ Usuário encontrado:', userId);

    // Passo 3: Associar usuário ao tenant
    console.log('\n🔗 Associando usuário ao tenant...');
    const { error: updateError } = await supabase
      .from('ghl_wa_users')
      .update({ tenant_id: tenant.id })
      .eq('id', userId);

    if (updateError) {
      console.error('❌ Erro ao associar usuário:', updateError.message);
      process.exit(1);
    }

    console.log('✅ Usuário associado ao tenant!');
    console.log('\n🎉 TUDO PRONTO!');
    console.log(`
📊 Resumo:
- Tenant ID: ${tenant.id}
- Nome: ${tenant.name}
- Plano: ${tenant.subscription_plan}
- Max Instâncias: ${tenant.max_instances}
- User ID: ${userId}

🌐 Acesse agora: https://nexus.socialfy.me e faça refresh (Ctrl+Shift+R)
    `);

  } catch (error) {
    console.error('❌ Erro inesperado:', error);
    process.exit(1);
  }
}

setupTenant();
