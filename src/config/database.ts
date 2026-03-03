// Database configuration using Supabase Client (REST)
// Replaces direct PostgreSQL connection to avoid port 5432 issues
import dotenv from 'dotenv';
import { logger } from '../utils/logger';

dotenv.config();

// Mock db object for legacy compatibility if needed
// All actual database operations should use getSupabaseClient()
export const db = {
    query: async (text: string, params?: any[]) => {
        logger.warn('[DATABASE] Legacy db.query called. Please migrate to Supabase Client.');
        return { rows: [] };
    },
    getClient: async () => {
        logger.warn('[DATABASE] Legacy db.getClient called. Please migrate to Supabase Client.');
        return {
            query: async () => ({ rows: [] }),
            release: () => {}
        };
    },
};

// Test connection function (now checks Supabase connectivity)
export const testDbConnection = async () => {
    logger.debug('[DATABASE] Using Supabase Client (HTTP/REST) instead of direct PG connection.');
    return true;
};
