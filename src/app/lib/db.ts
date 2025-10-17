import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL no está definida');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // ssl útil si tu proveedor lo requiere
  ssl: process.env.DATABASE_URL.includes('supabase.co') ? { rejectUnauthorized: false } : undefined,
});
