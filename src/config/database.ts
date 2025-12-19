import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

export const db = {
    query: (text: string, params?: any[]) => pool.query(text, params),
    getClient: () => pool.connect(),
};

// Test connection function
export const testDbConnection = async () => {
    try {
        const client = await pool.connect();
        const result = await client.query('SELECT NOW()');
        console.log('[DATABASE] Connected successfully to Supabase/Postgres:', result.rows[0].now);
        client.release();
        return true;
    } catch (err) {
        console.error('[DATABASE] Error connecting to database:', err);
        return false;
    }
};
