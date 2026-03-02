import { createReadStream } from 'fs';
import { parse } from 'csv-parse';
import { env } from '../config/env.js';
import { pool } from '../config/postgres.js';

/**
 * POST /api/migrate
 * Lee el CSV y distribuye los datos en las 5 tablas de PostgreSQL.
 *
 * Idempotencia:
 *  - Tablas maestras (categories, suppliers, customers, products):
 *    INSERT ... ON CONFLICT DO NOTHING → nunca duplica entidades.
 *  - transactions: se verifica por (transaction_id, product_sku) antes de insertar.
 *
 * Todo el proceso corre dentro de una única transacción SQL para
 * garantizar consistencia; si algo falla se hace ROLLBACK completo.
 */
export const runMigration = async (req, res, next) => {
  const client = await pool.connect();
  let inserted = 0;
  let skipped  = 0;

  try {
    await client.query('BEGIN');

    const records = await parseCsv(env.fileCsv);

    for (const row of records) {

      // 1. CATEGORY ─────────────────────────────────────────────────────────
      await client.query(
        `INSERT INTO categories (category_name)
         VALUES ($1) ON CONFLICT (category_name) DO NOTHING`,
        [row.product_category]
      );
      const { rows: catRows } = await client.query(
        `SELECT category_id FROM categories WHERE category_name = $1`,
        [row.product_category]
      );
      const categoryId = catRows[0].category_id;

      // 2. SUPPLIER ─────────────────────────────────────────────────────────
      await client.query(
        `INSERT INTO suppliers (supplier_name, supplier_email)
         VALUES ($1, $2) ON CONFLICT (supplier_email) DO NOTHING`,
        [row.supplier_name, row.supplier_email]
      );
      const { rows: supRows } = await client.query(
        `SELECT supplier_id FROM suppliers WHERE supplier_email = $1`,
        [row.supplier_email]
      );
      const supplierId = supRows[0].supplier_id;

      // 3. CUSTOMER ─────────────────────────────────────────────────────────
      await client.query(
        `INSERT INTO customers (customer_name, customer_email, customer_address, customer_phone)
         VALUES ($1, $2, $3, $4) ON CONFLICT (customer_email) DO NOTHING`,
        [row.customer_name, row.customer_email, row.customer_address, row.customer_phone]
      );
      const { rows: custRows } = await client.query(
        `SELECT customer_id FROM customers WHERE customer_email = $1`,
        [row.customer_email]
      );
      const customerId = custRows[0].customer_id;

      // 4. PRODUCT ──────────────────────────────────────────────────────────
      // quantity aquí representa el stock; se toma del CSV como valor inicial.
      // ON CONFLICT DO NOTHING: si el producto ya existe no se sobreescribe.
      await client.query(
        `INSERT INTO products (product_sku, product_name, unit_price, quantity, category_id)
         VALUES ($1, $2, $3, $4, $5) ON CONFLICT (product_sku) DO NOTHING`,
        [row.product_sku, row.product_name, parseFloat(row.unit_price),
         parseInt(row.quantity), categoryId]
      );

      // 5. TRANSACTION ──────────────────────────────────────────────────────
      // Evita duplicados por (transaction_id + product_sku)
      const { rows: check } = await client.query(
        `SELECT item_id FROM transactions
         WHERE transaction_id = $1 AND product_sku = $2`,
        [row.transaction_id, row.product_sku]
      );

      if (check.length === 0) {
        await client.query(
          `INSERT INTO transactions
             (transaction_id, transaction_date, customer_id, product_sku,
              supplier_id, quantity, unit_price, total_line_value)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            row.transaction_id,
            row.date,
            customerId,
            row.product_sku,
            supplierId,
            parseInt(row.quantity),
            parseFloat(row.unit_price),
            parseFloat(row.total_line_value),
          ]
        );
        inserted++;
      } else {
        skipped++;
      }
    }

    await client.query('COMMIT');
    res.json({
      message:  'Migración completada',
      total:    records.length,
      inserted,
      skipped,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ── Helper ────────────────────────────────────────────────────────────────────
const parseCsv = (filePath) =>
  new Promise((resolve, reject) => {
    const rows = [];
    createReadStream(filePath)
      .pipe(parse({ columns: true, trim: true, skip_empty_lines: true }))
      .on('data',  (row) => rows.push(row))
      .on('end',   ()    => resolve(rows))
      .on('error', (err) => reject(err));
  });
