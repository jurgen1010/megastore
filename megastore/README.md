# 🏪 MegaStore Global — API REST

Sistema de migración y consulta de datos para MegaStore Global.
Migra un archivo Excel/CSV legado a una arquitectura moderna con
PostgreSQL + MongoDB, expuesta a través de una API REST con Express.

---

## 📋 Tabla de contenido

1. [Descripción general](#descripción-general)
2. [Arquitectura](#arquitectura)
3. [Modelo de datos](#modelo-de-datos)
4. [Estructura del proyecto](#estructura-del-proyecto)
5. [Requisitos previos](#requisitos-previos)
6. [Instalación y configuración](#instalación-y-configuración)
7. [Endpoints disponibles](#endpoints-disponibles)
8. [Log de auditoría en MongoDB](#log-de-auditoría-en-mongodb)
9. [Decisiones técnicas](#decisiones-técnicas)

---

## 📖 Descripción general

MegaStore Global manejaba toda su operación en un único archivo CSV/Excel:
inventario, ventas, proveedores y clientes en una sola tabla plana.

Este proyecto resuelve esa crisis operativa mediante:

- **Normalización** del CSV hasta **3NF** (Tercera Forma Normal)
- **Migración** automática de los datos a **PostgreSQL**
- **Log de auditoría** de eliminaciones en **MongoDB**
- **API REST** con Express para exponer los datos

---

## 🏗️ Arquitectura

```
CSV legado
    │
    ▼
POST /api/migrate
    │
    ├──► PostgreSQL (datos relacionales normalizados)
    │       ├── categories
    │       ├── suppliers
    │       ├── customers
    │       ├── products
    │       └── transactions
    │
    └──► MongoDB (log de auditoría)
            └── audit_logs
                 └── snapshot del producto eliminado
```

### ¿Por qué dos bases de datos?

| Motor | Uso | Justificación |
|---|---|---|
| **PostgreSQL** | Datos maestros y transacciones | Relaciones entre entidades, integridad referencial, JOINs |
| **MongoDB** | Log de auditoría | Esquema flexible, datos históricos inmutables, embedding natural |

---

## 🗄️ Modelo de datos

### Normalización aplicada

El CSV original era una tabla plana con dependencias transitivas:

```
CSV plano (sin normalizar)
transaction_id, date, customer_name, customer_email, customer_address,
customer_phone, product_category, product_sku, product_name, unit_price,
quantity, total_line_value, supplier_name, supplier_email
```

Aplicando **3NF** se separa en 5 tablas:

```
customers          suppliers         categories
    │                  │                 │
    │                  │            ┌────┘
    │                  │            │
    └──────────────────┴────────────┤
                                    ▼
                                products
                                    │
                    ┌───────────────┘
                    │
                    ▼
              transactions
    (item_id, transaction_id, transaction_date,
     customer_id, product_sku, supplier_id,
     quantity, unit_price, total_line_value)
```

### Tablas PostgreSQL

#### `customers`
| Campo | Tipo | Descripción |
|---|---|---|
| `customer_id` | INTEGER (PK) | Autoincremental |
| `customer_name` | VARCHAR(255) | Nombre completo |
| `customer_email` | VARCHAR(255) UNIQUE | Email único |
| `customer_address` | VARCHAR(255) | Dirección |
| `customer_phone` | VARCHAR(20) | Teléfono |

#### `suppliers`
| Campo | Tipo | Descripción |
|---|---|---|
| `supplier_id` | INTEGER (PK) | Autoincremental |
| `supplier_name` | VARCHAR(255) UNIQUE | Nombre del proveedor |
| `supplier_email` | VARCHAR(255) UNIQUE | Email único |

#### `categories`
| Campo | Tipo | Descripción |
|---|---|---|
| `category_id` | INTEGER (PK) | Autoincremental |
| `category_name` | VARCHAR(255) UNIQUE | Nombre de categoría |

#### `products`
| Campo | Tipo | Descripción |
|---|---|---|
| `product_sku` | VARCHAR(100) (PK) | Código único del producto |
| `product_name` | VARCHAR(255) | Nombre del producto |
| `unit_price` | NUMERIC(14,2) | Precio de catálogo |
| `quantity` | INTEGER | Stock disponible |
| `category_id` | INTEGER (FK) | Referencia a `categories` |

#### `transactions`
| Campo | Tipo | Descripción |
|---|---|---|
| `item_id` | INTEGER (PK) | Autoincremental — PK real |
| `transaction_id` | VARCHAR(100) | Agrupa líneas de una misma compra |
| `transaction_date` | DATE | Fecha de la transacción |
| `customer_id` | INTEGER (FK) | Referencia a `customers` |
| `product_sku` | VARCHAR(100) (FK) | Referencia a `products` |
| `supplier_id` | INTEGER (FK) | Referencia a `suppliers` |
| `quantity` | INTEGER | Unidades compradas |
| `unit_price` | NUMERIC(14,2) | Precio al momento de la venta |
| `total_line_value` | NUMERIC(14,2) | `unit_price × quantity` |

> ⚠️ `unit_price` y `quantity` aparecen tanto en `products` como en `transactions`
> porque tienen significados distintos:
> - En `products`: precio de **catálogo** y **stock** disponible
> - En `transactions`: precio real al momento de la **venta** y unidades **vendidas**

### Colección MongoDB — `audit_logs`

```json
{
  "_id": "ObjectId(...)",
  "entity": "product",
  "action": "DELETE",
  "entityId": "MSE-LOG-502",
  "snapshot": {
    "product_sku": "MSE-LOG-502",
    "product_name": "Mouse Logitech M502",
    "unit_price": 150000,
    "quantity": 3,
    "category_id": 1
  },
  "deletedAt": "2026-03-02T10:30:00.000Z"
}
```

---

## 📁 Estructura del proyecto

```
megastore/
├── src/
│   ├── server.js                ← punto de entrada: arranca Express
│   ├── app.js                   ← configuración de Express y rutas
│   ├── config/
│   │   ├── env.js               ← variables de entorno validadas
│   │   ├── postgres.js          ← pool de conexión + initSchema
│   │   ├── mongo.js             ← conexión Mongoose + modelo AuditLog
│   │   └── schema.sql           ← DDL completo (se ejecuta al arrancar)
│   ├── routes/
│   │   ├── products.js          ← rutas CRUD de productos
│   │   ├── migrate.js           ← ruta de migración CSV
│   │   ├── suppliers.js         ← ruta BI proveedores
│   │   ├── customers.js         ← ruta BI historial cliente
│   │   └── categories.js        ← ruta BI top productos
│   ├── service/
│   │   ├── productsService.js   ← lógica CRUD + log auditoría MongoDB
│   │   ├── migrateService.js    ← lógica migración CSV → PostgreSQL
│   │   ├── suppliersService.js  ← lógica BI proveedores
│   │   ├── customersService.js  ← lógica BI historial cliente
│   │   └── categoriesService.js ← lógica BI top productos
│   └── middleware/
│       └── errorHandler.js      ← manejo centralizado de errores
├── data/
│   └── AM-prueba-desempeno-data_m4.csv  ← archivo fuente
├── .env                         ← variables de entorno (no subir a git)
├── .env.example                 ← plantilla de variables
├── package.json
└── README.md
```

---

## ✅ Requisitos previos

- **Node.js** v18 o superior
- **PostgreSQL** v14 o superior
- **MongoDB** v6 o superior (local o Atlas)
- **npm** v9 o superior

---

## ⚙️ Instalación y configuración

### 1. Clonar el repositorio

```bash
git clone https://github.com/Nataliavos/megastore.git
cd megastore
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
# Copiar el archivo de ejemplo
cp .env.example .env
```

Editar `.env` con tus credenciales:

```env
PORT=3000
POSTGRES_URI=postgresql://postgres:tu_password@localhost:5432/db_megastore_exam
MONGO_URI=mongodb://localhost:27017/db_megastore_exam
FILE_DATA_CSV=./data/AM-prueba-desempeno-data_m4.csv
```

### 4. Crear la base de datos en PostgreSQL

```bash
psql -U postgres -c "CREATE DATABASE db_megastore_exam;"
```

> Las tablas se crean **automáticamente** al arrancar el servidor
> gracias a `initSchema()` — no es necesario ejecutar el SQL manualmente.

### 5. Arrancar el servidor

```bash
# Producción
npm start

# Desarrollo (reinicia automáticamente al guardar)
npm run dev
```

Al arrancar correctamente verás:

```
✅ New connection established with PostgreSQL
🟢 PostgreSQL conectado: 2026-03-02T10:00:00.000Z
✅ Schema inicializado correctamente
🟢 MongoDB conectado: db_megastore_exam
🚀 Servidor corriendo en http://localhost:3000
```

### 6. Cargar los datos del CSV

```bash
POST http://localhost:3000/api/migrate
```

Respuesta esperada:

```json
{
  "message": "Migración completada",
  "total": 6,
  "inserted": 6,
  "skipped": 0
}
```

> Es **idempotente**: si se ejecuta varias veces no duplica datos.

---

## 🔌 Endpoints disponibles

### 🔄 Migración

| Método | Endpoint | Descripción |
|---|---|---|
| `POST` | `/api/migrate` | Carga el CSV completo en PostgreSQL |

### 📦 Productos

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/products` | Lista todos los productos con su categoría |
| `GET` | `/api/products/:sku` | Detalle de un producto por SKU |
| `POST` | `/api/products` | Crear un nuevo producto |
| `PUT` | `/api/products/:sku` | Actualizar un producto existente |
| `DELETE` | `/api/products/:sku` | Eliminar producto + guardar log en MongoDB |

**Body para POST/PUT:**
```json
{
  "product_sku": "KBD-LOG-001",
  "product_name": "Teclado Logitech K120",
  "unit_price": 85000,
  "quantity": 20,
  "category_id": 1
}
```

### 🏭 Proveedores (BI)

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/suppliers/analysis` | Proveedores ordenados por volumen de ventas |

**Respuesta:**
```json
[
  {
    "supplier_name": "TechWorld SAS",
    "supplier_email": "ventas@techworld.com",
    "total_items_sold": "14",
    "total_inventory_value": "10070000"
  }
]
```

### 👤 Clientes (BI)

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/customers/:email/history` | Historial de compras agrupado por transacción |

**Ejemplo:** `GET /api/customers/andres.lopez@gmail.com/history`

**Respuesta:**
```json
[
  {
    "transaction_id": "TXN-2001",
    "transaction_date": "2024-02-21",
    "items": [
      {
        "product_sku": "MSE-LOG-502",
        "product_name": "Mouse Logitech M502",
        "quantity": 3,
        "unit_price": "150000",
        "total_line_value": "450000"
      }
    ],
    "transaction_total": 4130000
  }
]
```

### 🗂️ Categorías (BI)

| Método | Endpoint | Descripción |
|---|---|---|
| `GET` | `/api/categories/:name/top-products` | Productos más vendidos de una categoría |

**Ejemplo:** `GET /api/categories/Electronics/top-products`

**Respuesta:**
```json
[
  {
    "product_sku": "TBL-SAM-10",
    "product_name": "Tablet Samsung 10\"",
    "total_units_sold": "3",
    "total_revenue": "3600000"
  }
]
```

---

## 🔍 Log de auditoría en MongoDB

Cada vez que se elimina un producto con `DELETE /api/products/:sku`,
el sistema guarda automáticamente un documento en MongoDB con:

- **`entity`**: tipo de entidad eliminada (`"product"`)
- **`action`**: acción realizada (`"DELETE"`)
- **`entityId`**: SKU del producto eliminado
- **`snapshot`**: copia exacta del registro al momento de eliminar
- **`deletedAt`**: fecha y hora del evento

Esto permite **auditar** qué productos fueron eliminados, cuándo y cómo
estaban configurados en ese momento, sin necesidad de hacer JOINs.

---

## 🧠 Decisiones técnicas

| Decisión | Justificación |
|---|---|
| `"type": "module"` en package.json | Usar ESM nativo de Node.js — imports más limpios y estándar moderno |
| `__dirname` construido manualmente | ESM no lo provee nativamente; se reconstruye con `fileURLToPath` |
| Schema SQL ejecutado al arrancar | `CREATE TABLE IF NOT EXISTS` es idempotente — seguro ejecutarlo siempre |
| `ON CONFLICT DO NOTHING` en migración | Garantiza idempotencia — re-ejecutar el CSV no duplica entidades maestras |
| `item_id` como PK en `transactions` | Un `transaction_id` tiene N productos — necesita PK propia por fila |
| Embedding del snapshot en MongoDB | Los logs son históricos e inmutables — no necesitan referencias externas |
| Pool de conexiones en PostgreSQL | Reutiliza conexiones en lugar de crear una nueva por request |
| Manejo centralizado de errores | `errorHandler.js` captura todos los errores sin repetir lógica en cada servicio |