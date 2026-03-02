import { Pool } from 'pg';
import { env } from './env.js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const pool = new Pool({ connectionString: env.postgresUri });

pool.on('connect', () => console.log('✅ PostgreSQL pool: nueva conexión'));
pool.on('error',  (err) => {
  console.error('❌ Error en el pool de PostgreSQL:', err.message);
  process.exit(1);
});

export const testConnection = async () => {
  const client = await pool.connect();
  try {
    const r = await client.query('SELECT NOW() AS time');
    console.log('🟢 PostgreSQL conectado:', r.rows[0].time);
  } finally {
    client.release();
  }
};

export const initSchema = async () => {
  const schemaPath = resolve(__dirname, './schema.sql');
  const sql        = readFileSync(schemaPath, 'utf-8');
  const client     = await pool.connect();
  try {
    await client.query(sql);
    console.log('✅ Schema inicializado correctamente');
  } catch (err) {
    console.error('❌ Error al inicializar el schema:', err.message);
    throw err;
  } finally {
    client.release();
  }
};

export const query = async (text, params = []) => {
  try {
    return await pool.query(text, params);
  } catch (err) {
    console.error('❌ Query error:', err.message);
    console.error('   SQL:', text);
    console.error('   Params:', params);
    throw err;
  }
};

export { pool };