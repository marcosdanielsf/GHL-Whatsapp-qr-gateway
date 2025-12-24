
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const SQL_FILE = path.join(__dirname, '../supabase-rpc-queue.sql');

async function deployRpc() {
  console.log('Deploying RPC function to Supabase...');

  const connectionString = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL;

  if (!connectionString) {
    console.error('❌ Error: DATABASE_URL or SUPABASE_DB_URL environment variable is not set.');
    console.error('Please set it to your Supabase PostgreSQL connection string (e.g., postgres://postgres.[ref]:[pass]@[host]:5432/postgres)');
    console.log('\nAlternatively, run the SQL in supabase-rpc-queue.sql manually in the Supabase SQL Editor.');
    process.exit(1);
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }, // Supabase requires SSL
  });

  try {
    await client.connect();
    console.log('✅ Connected to database.');

    const sql = fs.readFileSync(SQL_FILE, 'utf8');
    console.log(`📖 Reading SQL from ${SQL_FILE}...`);

    await client.query(sql);
    console.log('✅ RPC function fetch_pending_jobs deployed successfully!');
    
    // Notify PostgREST to reload schema cache (already in SQL, but good to confirm)
    console.log('🔄 PostgREST schema cache reload triggered.');

  } catch (err) {
    console.error('❌ Error deploying RPC:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

deployRpc();
