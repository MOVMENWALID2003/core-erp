from __future__ import annotations

import logging
import os
import queue
import sqlite3
import threading
from contextlib import contextmanager
from logging.handlers import QueueHandler, QueueListener, RotatingFileHandler
from pathlib import Path
from typing import Any, Iterator


LOGGER = logging.getLogger("gs_erp")
_LOG_QUEUE: queue.SimpleQueue[logging.LogRecord] = queue.SimpleQueue()
_LOG_LISTENER: QueueListener | None = None
_LOG_LOCK = threading.Lock()
if not LOGGER.handlers:
    LOGGER.addHandler(QueueHandler(_LOG_QUEUE))
    LOGGER.setLevel(logging.INFO)


def _start_file_logging() -> None:
    global _LOG_LISTENER
    with _LOG_LOCK:
        if _LOG_LISTENER is not None:
            return
        handler = RotatingFileHandler("error.log", maxBytes=1_000_000, backupCount=3, encoding="utf-8")
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        _LOG_LISTENER = QueueListener(_LOG_QUEUE, handler, respect_handler_level=True)
        _LOG_LISTENER.start()


SCHEMA = """
CREATE TABLE IF NOT EXISTS companies (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS warehouses (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'main' CHECK(type IN ('main','sub','transit','damaged','showroom','3pl','office')),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','frozen','archived')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS bins (
    id INTEGER PRIMARY KEY,
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    zone TEXT NOT NULL,
    aisle TEXT NOT NULL,
    rack TEXT NOT NULL,
    shelf TEXT NOT NULL,
    bin TEXT NOT NULL,
    code TEXT NOT NULL UNIQUE,
    capacity_qty INTEGER NOT NULL DEFAULT 0 CHECK(capacity_qty >= 0),
    status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','blocked','maintenance')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(warehouse_id, zone, aisle, rack, shelf, bin)
);
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    model_code TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    brand TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS product_variants (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    color TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    sku TEXT NOT NULL UNIQUE,
    barcode TEXT UNIQUE,
    reorder_point INTEGER NOT NULL DEFAULT 0 CHECK(reorder_point >= 0),
    avg_cost REAL NOT NULL DEFAULT 0 CHECK(avg_cost >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(product_id, color, size)
);
CREATE TABLE IF NOT EXISTS stock_movements (
    id INTEGER PRIMARY KEY,
    variant_id INTEGER NOT NULL REFERENCES product_variants(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    bin_id INTEGER REFERENCES bins(id),
    movement_type TEXT NOT NULL CHECK(movement_type IN ('receipt','issue','transfer_in','transfer_out','reserve','release','return','stocktake_adjustment','writeoff')),
    qty_onhand INTEGER NOT NULL DEFAULT 0,
    qty_reserved INTEGER NOT NULL DEFAULT 0,
    unit_cost REAL NOT NULL DEFAULT 0,
    user_name TEXT NOT NULL DEFAULT 'System',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    notes TEXT
);
CREATE TABLE IF NOT EXISTS stocktake_sessions (
    id INTEGER PRIMARY KEY,
    company_id INTEGER NOT NULL REFERENCES companies(id),
    warehouse_id INTEGER NOT NULL REFERENCES warehouses(id),
    kind TEXT NOT NULL CHECK(kind IN ('full','cycle','spot')),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','locked','closed','cancelled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    closed_at TEXT,
    notes TEXT
);
CREATE TABLE IF NOT EXISTS stocktake_lines (
    id INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES stocktake_sessions(id) ON DELETE CASCADE,
    variant_id INTEGER NOT NULL REFERENCES product_variants(id),
    bin_id INTEGER REFERENCES bins(id),
    book_qty INTEGER NOT NULL DEFAULT 0,
    counted_qty INTEGER CHECK(counted_qty IS NULL OR counted_qty >= 0),
    unit_cost REAL NOT NULL DEFAULT 0,
    variance_qty INTEGER,
    variance_value REAL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','matched','variance','approved')),
    UNIQUE(session_id, variant_id, bin_id)
);
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY,
    user_name TEXT NOT NULL,
    action_type TEXT NOT NULL,
    section_name TEXT NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_movement_balance ON stock_movements(variant_id, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_stocktake_status ON stocktake_sessions(status, warehouse_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
CREATE TRIGGER IF NOT EXISTS immutable_movement_update
BEFORE UPDATE ON stock_movements BEGIN SELECT RAISE(ABORT, 'stock ledger is immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_movement_delete
BEFORE DELETE ON stock_movements BEGIN SELECT RAISE(ABORT, 'stock ledger is immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_audit_update
BEFORE UPDATE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit log is immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_audit_delete
BEFORE DELETE ON audit_logs BEGIN SELECT RAISE(ABORT, 'audit log is immutable'); END;
"""


class AppDatabase:
    """SQLite data access. Each operation owns its connection; writes are serialized."""

    def __init__(self, path: str | Path | None = None) -> None:
        default_path = Path(__file__).resolve().with_name("gs_erp.sqlite3")
        self.path = Path(path or os.environ.get("GS_ERP_DB", default_path)).expanduser().resolve()
        self._write_lock = threading.RLock()
        self._init_lock = threading.Lock()
        self._initialized = False

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=15, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 15000")
        return connection

    @contextmanager
    def _transaction(self, *, write: bool = False) -> Iterator[sqlite3.Connection]:
        lock = self._write_lock if write else _NullLock()
        with lock:
            connection = self._connect()
            try:
                connection.execute("BEGIN IMMEDIATE" if write else "BEGIN")
                yield connection
                connection.commit()
            except Exception:
                connection.rollback()
                LOGGER.exception("SQLite transaction failed (write=%s)", write)
                raise
            finally:
                connection.close()

    @staticmethod
    def _audit(
        connection: sqlite3.Connection,
        action: str,
        section: str,
        old_value: Any = None,
        new_value: Any = None,
    ) -> None:
        connection.execute(
            "INSERT INTO audit_logs(user_name, action_type, section_name, old_value, new_value) VALUES (?, ?, ?, ?, ?)",
            ("System", action, section, str(old_value) if old_value is not None else None, str(new_value) if new_value is not None else None),
        )

    def initialize(self) -> None:
        with self._init_lock:
            if self._initialized:
                return
            _start_file_logging()
            self.path.parent.mkdir(parents=True, exist_ok=True)
            connection = self._connect()
            try:
                connection.execute("PRAGMA journal_mode = WAL")
                connection.execute("PRAGMA encoding = 'UTF-8'")
                connection.executescript(SCHEMA)
            except Exception:
                LOGGER.exception("Database initialization failed")
                raise
            finally:
                connection.close()
            self._seed_if_empty()
            self._initialized = True

    def _seed_if_empty(self) -> None:
        with self._transaction(write=True) as connection:
            if connection.execute("SELECT 1 FROM companies LIMIT 1").fetchone():
                return
            company_id = connection.execute(
                "INSERT INTO companies(name, code) VALUES (?, ?)", ("CORE ERP", "CORE")
            ).lastrowid
            warehouse_id = connection.execute(
                "INSERT INTO warehouses(company_id, code, name) VALUES (?, ?, ?)",
                (company_id, "WH-01", "المستودع الرئيسي"),
            ).lastrowid
            bin_id = connection.execute(
                "INSERT INTO bins(warehouse_id, zone, aisle, rack, shelf, bin, code, capacity_qty) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (warehouse_id, "Z01", "A01", "R01", "S01", "B01", "WH-01-Z01-A01-R01-S01-B01", 5000),
            ).lastrowid
            product_id = connection.execute(
                "INSERT INTO products(company_id, model_code, name, brand) VALUES (?, ?, ?, ?)",
                (company_id, "MOD-001", "قميص قطني", "CORE"),
            ).lastrowid
            variant_id = connection.execute(
                "INSERT INTO product_variants(product_id, color, size, sku, reorder_point, avg_cost) VALUES (?, ?, ?, ?, ?, ?)",
                (product_id, "أسود", "M", "CORE-COTTON-BLK-M", 5, 75.0),
            ).lastrowid
            connection.execute(
                "INSERT INTO stock_movements(variant_id, warehouse_id, bin_id, movement_type, qty_onhand, unit_cost, notes) VALUES (?, ?, ?, 'receipt', 24, 75, ?)",
                (variant_id, warehouse_id, bin_id, "رصيد افتتاحي"),
            )
            self._audit(connection, "تهيئة النظام", "database", new_value="CORE ERP")

    def load_workspace(self) -> dict[str, Any]:
        with self._transaction() as connection:
            company = dict(connection.execute("SELECT * FROM companies ORDER BY id LIMIT 1").fetchone())
            warehouses = [dict(row) for row in connection.execute("SELECT * FROM warehouses ORDER BY code")]
            bins = [dict(row) for row in connection.execute(
                "SELECT b.*, w.code AS warehouse_code FROM bins b JOIN warehouses w ON w.id=b.warehouse_id ORDER BY w.code, b.code"
            )]
            variants = [dict(row) for row in connection.execute("""
                SELECT v.*, p.name AS product_name, p.brand,
                    COALESCE(SUM(m.qty_onhand), 0) AS on_hand,
                    COALESCE(SUM(m.qty_reserved), 0) AS reserved,
                    COALESCE(SUM(m.qty_onhand - m.qty_reserved), 0) AS available
                FROM product_variants v JOIN products p ON p.id=v.product_id
                LEFT JOIN stock_movements m ON m.variant_id=v.id
                GROUP BY v.id ORDER BY p.name, v.sku
            """)]
            movements = [dict(row) for row in connection.execute("""
                SELECT m.*, v.sku, w.code AS warehouse_code
                FROM stock_movements m JOIN product_variants v ON v.id=m.variant_id
                JOIN warehouses w ON w.id=m.warehouse_id ORDER BY m.id DESC LIMIT 100
            """)]
            sessions = [dict(row) for row in connection.execute("""
                SELECT s.*, w.code AS warehouse_code,
                    COUNT(l.id) AS line_count,
                    SUM(CASE WHEN l.counted_qty IS NULL THEN 0 ELSE 1 END) AS counted_lines
                FROM stocktake_sessions s JOIN warehouses w ON w.id=s.warehouse_id
                LEFT JOIN stocktake_lines l ON l.session_id=s.id
                GROUP BY s.id ORDER BY s.id DESC
            """)]
            audit = [dict(row) for row in connection.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200")]
            lines = [dict(row) for row in connection.execute("""
                SELECT l.*, v.sku, p.name AS product_name
                FROM stocktake_lines l JOIN product_variants v ON v.id=l.variant_id
                JOIN products p ON p.id=v.product_id ORDER BY l.id
            """)]
            dashboard = {
                "warehouses": len(warehouses),
                "variants": len(variants),
                "units": sum(row["on_hand"] for row in variants),
                "alerts": sum(row["available"] <= row["reorder_point"] for row in variants),
            }
            return {
                "company": company,
                "dashboard": dashboard,
                "warehouses": warehouses,
                "bins": bins,
                "variants": variants,
                "movements": movements,
                "sessions": sessions,
                "stocktake_lines": lines,
                "audit": audit,
            }

    def save_warehouse(self, code: str, name: str, warehouse_type: str, record_id: int | None = None) -> None:
        code, name = code.strip().upper(), name.strip()
        if not code or not name:
            raise ValueError("كود واسم المستودع مطلوبان")
        if warehouse_type not in {"main", "sub", "transit", "damaged", "showroom", "3pl", "office"}:
            raise ValueError("نوع المستودع غير صالح")
        with self._transaction(write=True) as connection:
            company_id = connection.execute("SELECT id FROM companies ORDER BY id LIMIT 1").fetchone()[0]
            if record_id is None:
                cursor = connection.execute(
                    "INSERT INTO warehouses(company_id, code, name, type) VALUES (?, ?, ?, ?)",
                    (company_id, code, name, warehouse_type),
                )
                self._audit(connection, "إضافة مستودع", "warehouse", new_value=f"{code}: {name}")
            else:
                old = connection.execute("SELECT code, name FROM warehouses WHERE id=?", (record_id,)).fetchone()
                if old is None:
                    raise ValueError("المستودع غير موجود")
                connection.execute("UPDATE warehouses SET code=?, name=?, type=? WHERE id=?", (code, name, warehouse_type, record_id))
                self._audit(connection, "تعديل مستودع", "warehouse", old_value=tuple(old), new_value=f"{code}: {name}")

    def delete_warehouse(self, record_id: int) -> None:
        with self._transaction(write=True) as connection:
            row = connection.execute("SELECT code FROM warehouses WHERE id=?", (record_id,)).fetchone()
            if row is None:
                raise ValueError("المستودع غير موجود")
            connection.execute("DELETE FROM warehouses WHERE id=?", (record_id,))
            self._audit(connection, "حذف مستودع", "warehouse", old_value=row["code"])

    def save_bin(self, values: dict[str, Any], record_id: int | None = None) -> None:
        fields = [str(values.get(key, "")).strip().upper() for key in ("zone", "aisle", "rack", "shelf", "bin")]
        if not values.get("warehouse_id") or any(not item for item in fields):
            raise ValueError("اختر المستودع وأكمل بيانات المكان")
        capacity = int(values.get("capacity_qty", 0))
        if capacity < 0:
            raise ValueError("السعة لا يمكن أن تكون سالبة")
        code = "-".join([str(values["warehouse_code"]).strip().upper(), *fields])
        with self._transaction(write=True) as connection:
            if record_id is None:
                connection.execute("""
                    INSERT INTO bins(warehouse_id, zone, aisle, rack, shelf, bin, code, capacity_qty)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (values["warehouse_id"], *fields, code, capacity))
                self._audit(connection, "إضافة مكان تخزين", "bin", new_value=code)
            else:
                old = connection.execute("SELECT code FROM bins WHERE id=?", (record_id,)).fetchone()
                if old is None:
                    raise ValueError("مكان التخزين غير موجود")
                connection.execute("""
                    UPDATE bins SET warehouse_id=?, zone=?, aisle=?, rack=?, shelf=?, bin=?, code=?, capacity_qty=?
                    WHERE id=?
                """, (values["warehouse_id"], *fields, code, capacity, record_id))
                self._audit(connection, "تعديل مكان تخزين", "bin", old_value=old["code"], new_value=code)

    def delete_bin(self, record_id: int) -> None:
        with self._transaction(write=True) as connection:
            row = connection.execute("SELECT code FROM bins WHERE id=?", (record_id,)).fetchone()
            if row is None:
                raise ValueError("مكان التخزين غير موجود")
            connection.execute("DELETE FROM bins WHERE id=?", (record_id,))
            self._audit(connection, "حذف مكان تخزين", "bin", old_value=row["code"])

    def save_variant(self, values: dict[str, Any], record_id: int | None = None) -> None:
        product_name = str(values.get("product_name", "")).strip()
        sku = str(values.get("sku", "")).strip().upper()
        color, size = str(values.get("color", "")).strip(), str(values.get("size", "")).strip()
        cost, reorder = float(values.get("cost", 0)), int(values.get("reorder_point", 0))
        if not product_name or not sku:
            raise ValueError("اسم المنتج وSKU مطلوبان")
        if cost < 0 or reorder < 0:
            raise ValueError("التكلفة وحد الطلب يجب ألا يكونا سالبين")
        with self._transaction(write=True) as connection:
            company_id = connection.execute("SELECT id FROM companies ORDER BY id LIMIT 1").fetchone()[0]
            product = connection.execute("SELECT id FROM products WHERE name=? AND brand=? LIMIT 1", (product_name, str(values.get("brand", "")).strip())).fetchone()
            if product:
                product_id = product["id"]
            else:
                product_id = connection.execute(
                    "INSERT INTO products(company_id, model_code, name, brand) VALUES (?, ?, ?, ?)",
                    (company_id, f"MOD-{threading.get_ident()}-{os.urandom(3).hex()}", product_name, str(values.get("brand", "")).strip()),
                ).lastrowid
            barcode = str(values.get("barcode", "")).strip() or None
            if record_id is None:
                connection.execute("""
                    INSERT INTO product_variants(product_id, color, size, sku, barcode, reorder_point, avg_cost)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (product_id, color, size, sku, barcode, reorder, cost))
                self._audit(connection, "إضافة صنف", "inventory", new_value=sku)
            else:
                old = connection.execute("SELECT sku FROM product_variants WHERE id=?", (record_id,)).fetchone()
                if old is None:
                    raise ValueError("الصنف غير موجود")
                connection.execute("""
                    UPDATE product_variants SET product_id=?, color=?, size=?, sku=?, barcode=?, reorder_point=?, avg_cost=?
                    WHERE id=?
                """, (product_id, color, size, sku, barcode, reorder, cost, record_id))
                self._audit(connection, "تعديل صنف", "inventory", old_value=old["sku"], new_value=sku)

    def delete_variant(self, record_id: int) -> None:
        with self._transaction(write=True) as connection:
            row = connection.execute("SELECT sku FROM product_variants WHERE id=?", (record_id,)).fetchone()
            if row is None:
                raise ValueError("الصنف غير موجود")
            connection.execute("DELETE FROM product_variants WHERE id=?", (record_id,))
            self._audit(connection, "حذف صنف", "inventory", old_value=row["sku"])

    def record_movement(self, values: dict[str, Any]) -> None:
        movement_type = str(values.get("movement_type", ""))
        qty = int(values.get("qty", 0))
        if qty <= 0:
            raise ValueError("الكمية يجب أن تكون أكبر من صفر")
        mapping = {
            "receipt": (qty, 0), "return": (qty, 0), "transfer_in": (qty, 0),
            "issue": (-qty, 0), "transfer_out": (-qty, 0), "writeoff": (-qty, 0),
            "reserve": (0, qty), "release": (0, -qty),
        }
        if movement_type not in mapping:
            raise ValueError("نوع الحركة غير صالح")
        on_hand_delta, reserved_delta = mapping[movement_type]
        with self._transaction(write=True) as connection:
            variant_id, warehouse_id = int(values["variant_id"]), int(values["warehouse_id"])
            balance = connection.execute("""
                SELECT COALESCE(SUM(qty_onhand),0) AS on_hand, COALESCE(SUM(qty_reserved),0) AS reserved
                FROM stock_movements WHERE variant_id=? AND warehouse_id=?
            """, (variant_id, warehouse_id)).fetchone()
            if on_hand_delta < 0 and -on_hand_delta > balance["on_hand"] - balance["reserved"]:
                raise ValueError(f"الرصيد المتاح غير كافٍ: {balance['on_hand'] - balance['reserved']}")
            if reserved_delta < 0 and -reserved_delta > balance["reserved"]:
                raise ValueError(f"الرصيد المحجوز غير كافٍ: {balance['reserved']}")
            if reserved_delta > 0 and reserved_delta > balance["on_hand"] - balance["reserved"]:
                raise ValueError(f"الرصيد المتاح للحجز غير كافٍ: {balance['on_hand'] - balance['reserved']}")
            variant = connection.execute("SELECT avg_cost FROM product_variants WHERE id=?", (variant_id,)).fetchone()
            if variant is None:
                raise ValueError("الصنف غير موجود")
            bin_id = values.get("bin_id") or None
            if bin_id:
                found = connection.execute("SELECT warehouse_id FROM bins WHERE id=?", (bin_id,)).fetchone()
                if found is None or found["warehouse_id"] != warehouse_id:
                    raise ValueError("مكان التخزين لا يتبع المستودع المحدد")
            unit_cost = float(values.get("unit_cost", variant["avg_cost"]))
            connection.execute("""
                INSERT INTO stock_movements(variant_id, warehouse_id, bin_id, movement_type, qty_onhand, qty_reserved, unit_cost, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (variant_id, warehouse_id, bin_id, movement_type, on_hand_delta, reserved_delta, unit_cost, str(values.get("notes", "")).strip()))
            if movement_type in {"receipt", "return", "transfer_in"} and unit_cost >= 0:
                total = balance["on_hand"]
                weighted_cost = ((total * variant["avg_cost"]) + (qty * unit_cost)) / (total + qty) if total + qty else unit_cost
                connection.execute("UPDATE product_variants SET avg_cost=? WHERE id=?", (weighted_cost, variant_id))
            self._audit(connection, "حركة مخزون", "inventory", new_value=f"{movement_type} {qty} / SKU {variant_id}")

    def create_stocktake(self, warehouse_id: int, kind: str) -> int:
        if kind not in {"full", "cycle", "spot"}:
            raise ValueError("نوع الجرد غير صالح")
        with self._transaction(write=True) as connection:
            company_id = connection.execute("SELECT id FROM companies ORDER BY id LIMIT 1").fetchone()[0]
            session_id = connection.execute(
                "INSERT INTO stocktake_sessions(company_id, warehouse_id, kind, status) VALUES (?, ?, ?, 'in_progress')",
                (company_id, warehouse_id, kind),
            ).lastrowid
            connection.execute("""
                INSERT INTO stocktake_lines(session_id, variant_id, bin_id, book_qty, unit_cost)
                SELECT ?, v.id, (SELECT m.bin_id FROM stock_movements m WHERE m.variant_id=v.id AND m.warehouse_id=? AND m.bin_id IS NOT NULL ORDER BY m.id DESC LIMIT 1),
                    COALESCE(SUM(m.qty_onhand),0), v.avg_cost
                FROM product_variants v LEFT JOIN stock_movements m ON m.variant_id=v.id AND m.warehouse_id=?
                WHERE v.active=1 GROUP BY v.id
            """, (session_id, warehouse_id, warehouse_id))
            self._audit(connection, "إنشاء جلسة جرد", "stocktake", new_value=f"{session_id} / warehouse {warehouse_id}")
            return int(session_id)

    def set_stocktake_count(self, line_id: int, counted_qty: int) -> None:
        counted_qty = int(counted_qty)
        if counted_qty < 0:
            raise ValueError("الكمية المرصودة لا يمكن أن تكون سالبة")
        with self._transaction(write=True) as connection:
            row = connection.execute("""
                SELECT l.book_qty, l.unit_cost, s.status FROM stocktake_lines l
                JOIN stocktake_sessions s ON s.id=l.session_id WHERE l.id=?
            """, (line_id,)).fetchone()
            if row is None:
                raise ValueError("سطر الجرد غير موجود")
            if row["status"] in {"closed", "cancelled"}:
                raise ValueError("جلسة الجرد مغلقة")
            variance = counted_qty - row["book_qty"]
            connection.execute("""
                UPDATE stocktake_lines SET counted_qty=?, variance_qty=?, variance_value=?, status=? WHERE id=?
            """, (counted_qty, variance, variance * row["unit_cost"], "matched" if variance == 0 else "variance", line_id))

    def approve_stocktake(self, session_id: int) -> None:
        with self._transaction(write=True) as connection:
            session = connection.execute("SELECT * FROM stocktake_sessions WHERE id=?", (session_id,)).fetchone()
            if session is None:
                raise ValueError("جلسة الجرد غير موجودة")
            if session["status"] == "closed":
                raise ValueError("تم اعتماد الجلسة مسبقاً")
            lines = connection.execute("SELECT * FROM stocktake_lines WHERE session_id=?", (session_id,)).fetchall()
            if not lines or any(line["counted_qty"] is None for line in lines):
                raise ValueError("أدخل الكميات المرصودة لجميع الأصناف قبل الاعتماد")
            for line in lines:
                variance = line["counted_qty"] - line["book_qty"]
                if variance:
                    connection.execute("""
                        INSERT INTO stock_movements(variant_id, warehouse_id, bin_id, movement_type, qty_onhand, unit_cost, notes)
                        VALUES (?, ?, ?, 'stocktake_adjustment', ?, ?, ?)
                    """, (line["variant_id"], session["warehouse_id"], line["bin_id"], variance, line["unit_cost"], f"تسوية جرد #{session_id}"))
                connection.execute("UPDATE stocktake_lines SET variance_qty=?, variance_value=?, status='approved' WHERE id=?", (variance, variance * line["unit_cost"], line["id"]))
            connection.execute("UPDATE stocktake_sessions SET status='closed', closed_at=CURRENT_TIMESTAMP WHERE id=?", (session_id,))
            self._audit(connection, "اعتماد تسوية جرد", "stocktake", new_value=f"session {session_id}")

    def list_audit(self, limit: int = 500) -> list[dict[str, Any]]:
        with self._transaction() as connection:
            return [dict(row) for row in connection.execute("SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?", (max(1, min(int(limit), 5000)),))]


class _NullLock:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *_: object) -> None:
        return None