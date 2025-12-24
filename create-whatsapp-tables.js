// Criar tabelas do WhatsApp Gateway no Supabase CEO
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const SUPABASE_URL = 'https://bfumywvwubvernvhjehk.supabase.co';
const SUPABASE_SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJmdW15d3Z3dWJ2ZXJudmhqZWhrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTQwMzc5OSwiZXhwIjoyMDY2OTc5Nzk5fQ.fdTsdGlSqemXzrXEU4ov1SUpeDn_3bSjOingqkSAWQE';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function createTables() {
  console.log('📦 Criando tabelas do WhatsApp Gateway no Supabase CEO...\n');

  try {
    // Ler o arquivo SQL
    const sqlPath = join(__dirname, 'supabase-whatsapp-schema.sql');
    const sql = readFileSync(sqlPath, 'utf8');

    console.log('📄 SQL carregado:', sql.split('\n').length, 'linhas');
    console.log('🚀 Executando SQL no Supabase...\n');

    // Executar o SQL via RPC
    // Nota: Supabase não tem método direto para SQL, então vamos criar as tabelas via API
    // ou usar o SQL Editor do dashboard

    console.log('⚠️  ATENÇÃO: Supabase client não executa SQL direto.');
    console.log('📋 Você precisa executar o SQL de uma das formas:\n');
    console.log('OPÇÃO 1: Via Dashboard (RECOMENDADO)');
    console.log('  1. Acesse: https://supabase.com/dashboard/project/bfumywvwubvernvhjehk/sql');
    console.log('  2. Abra o arquivo: supabase-whatsapp-schema.sql');
    console.log('  3. Copie e cole no SQL Editor');
    console.log('  4. Click em "RUN"\n');

    console.log('OPÇÃO 2: Via psql (linha de comando)');
    console.log('  psql "postgresql://postgres.[PROJECT_REF]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres" -f supabase-whatsapp-schema.sql\n');

    console.log('OPÇÃO 3: Via Supabase CLI');
    console.log('  supabase db push\n');

    console.log('Vou tentar criar as tabelas uma por uma via API...\n');

    // Criar tabelas essenciais via queries individuais
    const tables = [
      {
        name: 'whatsapp_queue',
        check: async () => {
          const { error } = await supabase.from('whatsapp_queue').select('count').limit(0);
          return !error || !error.message.includes('does not exist');
        }
      },
      {
        name: 'whatsapp_pending_messages',
        check: async () => {
          const { error } = await supabase.from('whatsapp_pending_messages').select('count').limit(0);
          return !error || !error.message.includes('does not exist');
        }
      },
      {
        name: 'whatsapp_sessions',
        check: async () => {
          const { error } = await supabase.from('whatsapp_sessions').select('count').limit(0);
          return !error || !error.message.includes('does not exist');
        }
      },
      {
        name: 'whatsapp_cache',
        check: async () => {
          const { error } = await supabase.from('whatsapp_cache').select('count').limit(0);
          return !error || !error.message.includes('does not exist');
        }
      }
    ];

    for (const table of tables) {
      const exists = await table.check();
      if (exists) {
        console.log(`✅ ${table.name} - JÁ EXISTE`);
      } else {
        console.log(`❌ ${table.name} - PRECISA SER CRIADA`);
      }
    }

    console.log('\n💡 Para criar as tabelas, execute o SQL do arquivo supabase-whatsapp-schema.sql');
    console.log('   no SQL Editor do Supabase Dashboard (opção 1 acima).\n');

  } catch (error) {
    console.error('❌ Erro:', error.message);
  }
}

createTables().catch(console.error);
