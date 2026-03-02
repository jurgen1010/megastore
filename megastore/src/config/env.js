import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// ESM no expone __dirname de forma nativa; se construye así
const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

config({ path: resolve(__dirname, '../../.env') });

// Variables obligatorias
const required = ['MONGO_URI', 'POSTGRES_URI'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

export const env = {
  port:        process.env.PORT          ?? 3000,
  mongoUri:    process.env.MONGO_URI,
  postgresUri: process.env.POSTGRES_URI,
  fileCsv:     process.env.FILE_DATA_CSV ?? './data/AM-prueba-desempeno-data_m4.csv',
};