PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE companies (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  tax_number TEXT,
  country TEXT DEFAULT 'SA',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE warehouses (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'main' CHECK(type IN ('main','sub','transit','damaged','showroom','3pl','office')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','frozen','archived')),
  manager_user_id INTEGER,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE bins (
  id INTEGER PRIMARY KEY,
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  zone TEXT NOT NULL,
  aisle TEXT NOT NULL,
  rack TEXT NOT NULL,
  shelf TEXT NOT NULL,
  bin TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  capacity_qty INTEGER DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked','maintenance')),
  UNIQUE(warehouse_id, zone, aisle, rack, shelf, bin)
);

CREATE TABLE categories (
  id INTEGER PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  parent_id INTEGER REFERENCES categories(id),
  description TEXT
);

CREATE TABLE products (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  model_code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  brand TEXT,
  description TEXT,
  image_url TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE product_variants (
  id INTEGER PRIMARY KEY,
  product_id INTEGER NOT NULL REFERENCES products(id),
  color TEXT,
  size TEXT,
  sku TEXT UNIQUE NOT NULL,
  barcode TEXT UNIQUE,
  reorder_point INTEGER NOT NULL DEFAULT 0,
  avg_cost REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(product_id, color, size)
);

CREATE TABLE price_lists (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  name TEXT NOT NULL,
  code TEXT UNIQUE NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE variant_prices (
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  price_list_id INTEGER NOT NULL REFERENCES price_lists(id),
  min_qty INTEGER NOT NULL DEFAULT 1,
  price REAL NOT NULL,
  PRIMARY KEY (variant_id, price_list_id, min_qty)
);

CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  description TEXT
);

CREATE TABLE role_permissions (
  role_id INTEGER NOT NULL REFERENCES roles(id),
  screen_name TEXT NOT NULL,
  field_name TEXT,
  can_view INTEGER NOT NULL DEFAULT 1,
  can_write INTEGER NOT NULL DEFAULT 0,
  can_approve INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(role_id, screen_name, field_name)
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  username TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role_id INTEGER REFERENCES roles(id),
  active INTEGER NOT NULL DEFAULT 1,
  workstation_name TEXT,
  last_login_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stock_movements (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  bin_id INTEGER REFERENCES bins(id),
  movement_type TEXT NOT NULL CHECK(movement_type IN (
    'receipt','issue','transfer_in','transfer_out','reserve','release','return','stocktake_adjustment','writeoff'
  )),
  qty_onhand INTEGER NOT NULL DEFAULT 0,
  qty_reserved INTEGER NOT NULL DEFAULT 0,
  unit_cost REAL,
  ref_type TEXT,
  ref_id INTEGER,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes TEXT
);

CREATE TABLE stock_balance_snapshot (
  id INTEGER PRIMARY KEY,
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  on_hand INTEGER NOT NULL DEFAULT 0,
  reserved INTEGER NOT NULL DEFAULT 0,
  available_to_sell INTEGER NOT NULL DEFAULT 0,
  snapshot_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE stocktake_sessions (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
  kind TEXT NOT NULL CHECK(kind IN ('full', 'cycle', 'spot')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','locked','closed','cancelled')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at TEXT,
  notes TEXT
);

CREATE TABLE stocktake_lines (
  id INTEGER PRIMARY KEY,
  session_id INTEGER NOT NULL REFERENCES stocktake_sessions(id),
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  bin_id INTEGER REFERENCES bins(id),
  book_qty INTEGER NOT NULL DEFAULT 0,
  counted_qty INTEGER,
  unit_cost REAL,
  assigned_to INTEGER REFERENCES users(id),
  variance_qty INTEGER,
  variance_value REAL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','matched','variance','approved')),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_orders (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  supplier_name TEXT NOT NULL,
  warehouse_id INTEGER REFERENCES warehouses(id),
  status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','approved','received','cancelled')),
  total_amount REAL DEFAULT 0,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE purchase_order_lines (
  id INTEGER PRIMARY KEY,
  purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
  variant_id INTEGER NOT NULL REFERENCES product_variants(id),
  qty INTEGER NOT NULL,
  unit_cost REAL NOT NULL,
  expected_receipt_at TEXT
);

CREATE TABLE audit_logs (
  id INTEGER PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  user_name TEXT,
  role_name TEXT,
  action_type TEXT NOT NULL,
  section_name TEXT,
  old_value TEXT,
  new_value TEXT,
  device_name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE notifications (
  id INTEGER PRIMARY KEY,
  company_id INTEGER NOT NULL REFERENCES companies(id),
  kind TEXT NOT NULL CHECK(kind IN ('low_stock','out_of_stock','slow_moving','stocktake','shipping','security')),
  message TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('info','warning','critical')),
  read_flag INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_bins_warehouse ON bins(warehouse_id);
CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_variant_prices_list ON variant_prices(price_list_id);
CREATE INDEX idx_stock_movements_variant ON stock_movements(variant_id, warehouse_id, created_at);
CREATE INDEX idx_stocktake_sessions_warehouse ON stocktake_sessions(warehouse_id, status);
CREATE INDEX idx_audit_logs_user_time ON audit_logs(user_id, created_at);

CREATE VIEW stock_balance AS
SELECT
  sm.variant_id,
  sm.warehouse_id,
  SUM(sm.qty_onhand) AS on_hand,
  SUM(sm.qty_reserved) AS reserved,
  SUM(sm.qty_onhand) - SUM(sm.qty_reserved) AS available_to_sell
FROM stock_movements sm
GROUP BY sm.variant_id, sm.warehouse_id;

CREATE TRIGGER stock_movements_immutable_update
BEFORE UPDATE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock ledger is immutable');
END;

CREATE TRIGGER stock_movements_immutable_delete
BEFORE DELETE ON stock_movements
BEGIN
  SELECT RAISE(ABORT, 'stock ledger is immutable');
END;

CREATE TRIGGER audit_logs_immutable_update
BEFORE UPDATE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit log is immutable');
END;

CREATE TRIGGER audit_logs_immutable_delete
BEFORE DELETE ON audit_logs
BEGIN
  SELECT RAISE(ABORT, 'audit log is immutable');
END;

CREATE TRIGGER prevent_duplicate_bin_code
BEFORE INSERT ON bins
BEGIN
  SELECT CASE
    WHEN NEW.code IS NULL OR LENGTH(TRIM(NEW.code)) = 0 THEN RAISE(ABORT, 'bin code is required')
    WHEN EXISTS (SELECT 1 FROM bins WHERE code = NEW.code AND id != NEW.id) THEN RAISE(ABORT, 'duplicate bin code')
  END;
END;

CREATE TRIGGER auto_stocktake_variance
AFTER UPDATE ON stocktake_lines
WHEN NEW.counted_qty IS NOT NULL AND NEW.book_qty != NEW.counted_qty
BEGIN
  UPDATE stocktake_lines
  SET variance_qty = NEW.counted_qty - NEW.book_qty,
      variance_value = (NEW.counted_qty - NEW.book_qty) * COALESCE(NEW.unit_cost, 0)
  WHERE id = NEW.id;
END;
