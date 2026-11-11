from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from database import AppDatabase


class AppDatabaseTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary_directory = tempfile.TemporaryDirectory()
        self.database = AppDatabase(Path(self.temporary_directory.name) / "test.sqlite3")
        self.database.initialize()
        workspace = self.database.load_workspace()
        self.warehouse = workspace["warehouses"][0]
        self.variant = workspace["variants"][0]

    def tearDown(self) -> None:
        self.temporary_directory.cleanup()

    def test_arabic_location_data_round_trips(self) -> None:
        self.database.save_warehouse("AR-02", "مستودع القاهرة", "sub")
        workspace = self.database.load_workspace()
        warehouse = next(row for row in workspace["warehouses"] if row["code"] == "AR-02")
        self.database.save_bin({
            "warehouse_id": warehouse["id"],
            "warehouse_code": warehouse["code"],
            "zone": "منطقة أ",
            "aisle": "ممر ١",
            "rack": "رف ٢",
            "shelf": "طبقة ٣",
            "bin": "خانة ٤",
            "capacity_qty": 120,
        })
        saved = next(row for row in self.database.load_workspace()["bins"] if row["warehouse_code"] == "AR-02")
        self.assertIn("منطقة أ", saved["code"])

    def test_insufficient_movement_rolls_back(self) -> None:
        self.database.record_movement({
            "variant_id": self.variant["id"],
            "warehouse_id": self.warehouse["id"],
            "movement_type": "issue",
            "qty": 20,
        })
        with self.assertRaisesRegex(ValueError, "غير كافٍ"):
            self.database.record_movement({
                "variant_id": self.variant["id"],
                "warehouse_id": self.warehouse["id"],
                "movement_type": "issue",
                "qty": 5,
            })
        saved_variant = next(row for row in self.database.load_workspace()["variants"] if row["id"] == self.variant["id"])
        self.assertEqual(saved_variant["on_hand"], 4)

    def test_stocktake_approval_posts_variance_and_audit(self) -> None:
        session_id = self.database.create_stocktake(self.warehouse["id"], "full")
        lines = [row for row in self.database.load_workspace()["stocktake_lines"] if row["session_id"] == session_id]
        self.assertTrue(lines)
        for line in lines:
            self.database.set_stocktake_count(line["id"], line["book_qty"] + 2)
        self.database.approve_stocktake(session_id)
        workspace = self.database.load_workspace()
        session = next(row for row in workspace["sessions"] if row["id"] == session_id)
        variant = next(row for row in workspace["variants"] if row["id"] == self.variant["id"])
        self.assertEqual(session["status"], "closed")
        self.assertEqual(variant["on_hand"], self.variant["on_hand"] + 2)
        self.assertTrue(any(row["action_type"] == "اعتماد تسوية جرد" for row in workspace["audit"]))


if __name__ == "__main__":
    unittest.main()