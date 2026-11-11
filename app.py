from __future__ import annotations

import logging
import queue
import tkinter as tk
from concurrent.futures import Future, ThreadPoolExecutor
from tkinter import messagebox, ttk
from typing import Any, Callable

from database import AppDatabase, LOGGER
from ui_components import COLORS, FormField, build_table, card, configure_theme, set_status


class ErpApp(tk.Tk):
    def __init__(self) -> None:
        super().__init__()
        self.title("CORE ERP | نظام إدارة الموارد المتكامل")
        screen_width, screen_height = self.winfo_screenwidth(), self.winfo_screenheight()
        self.geometry(f"{min(1440, screen_width - 40)}x{min(900, screen_height - 80)}")
        self.minsize(min(1000, screen_width), min(680, screen_height))
        self.configure(background=COLORS["background"])
        configure_theme(self)

        self.database = AppDatabase()
        self.executor = ThreadPoolExecutor(max_workers=4, thread_name_prefix="gs-erp")
        self.events: queue.Queue[tuple[Callable[..., None] | None, Any, bool]] = queue.Queue()
        self.workspace: dict[str, Any] = {}
        self.pages: dict[str, ttk.Frame] = {}
        self.page_titles = {
            "dashboard": "لوحة التحكم",
            "inventory": "الأصناف والمخزون",
            "locations": "المستودعات والمواقع",
            "movements": "حركات المخزون",
            "stocktake": "الجرد والتسويات",
            "audit": "سجل الرقابة",
        }
        self.current_page = "dashboard"
        self.selected_stocktake_id: int | None = None
        self.selected_ids: dict[str, int | None] = {"warehouse": None, "bin": None, "variant": None}
        self._build_shell()
        self._build_pages()
        self.show_page("dashboard")
        self.protocol("WM_DELETE_WINDOW", self._close)
        self.after(80, self._drain_events)
        self._run(self.database.initialize, self._refresh)

    def _build_shell(self) -> None:
        self.rowconfigure(0, weight=1)
        self.columnconfigure(0, weight=1)
        self.columnconfigure(1, weight=0)
        self.main = ttk.Frame(self, padding=(22, 18, 22, 14))
        self.main.grid(row=0, column=0, sticky="nsew")
        self.main.rowconfigure(1, weight=1)
        self.main.columnconfigure(0, weight=1)

        header = ttk.Frame(self.main)
        header.grid(row=0, column=0, sticky="ew", pady=(0, 16))
        header.columnconfigure(0, weight=1)
        self.heading = ttk.Label(header, text="لوحة التحكم", style="Title.TLabel", anchor="e")
        self.heading.grid(row=0, column=0, sticky="ew")
        self.status = ttk.Label(header, text="جار تهيئة قاعدة البيانات...", anchor="e")
        self.status.grid(row=1, column=0, sticky="ew", pady=(5, 0))
        self.content = ttk.Frame(self.main)
        self.content.grid(row=1, column=0, sticky="nsew")
        self.content.rowconfigure(0, weight=1)
        self.content.columnconfigure(0, weight=1)

        sidebar = ttk.Frame(self, padding=(12, 18), style="Card.TFrame")
        sidebar.grid(row=0, column=1, sticky="ns")
        sidebar.columnconfigure(0, weight=1)
        ttk.Label(sidebar, text="CORE ERP", style="Metric.TLabel", anchor="center").grid(row=0, column=0, sticky="ew", pady=(0, 24))
        nav_items = [
            ("dashboard", "لوحة التحكم"),
            ("inventory", "الأصناف والمخزون"),
            ("locations", "المستودعات والمواقع"),
            ("movements", "حركات المخزون"),
            ("stocktake", "الجرد والتسويات"),
            ("audit", "سجل الرقابة"),
        ]
        for row, (key, title) in enumerate(nav_items, start=1):
            ttk.Button(sidebar, text=title, command=lambda page=key: self.show_page(page), width=22).grid(
                row=row, column=0, sticky="ew", pady=4
            )

    def _build_pages(self) -> None:
        builders = {
            "dashboard": self._build_dashboard,
            "inventory": self._build_inventory,
            "locations": self._build_locations,
            "movements": self._build_movements,
            "stocktake": self._build_stocktake,
            "audit": self._build_audit,
        }
        for name, builder in builders.items():
            frame = ttk.Frame(self.content)
            frame.grid(row=0, column=0, sticky="nsew")
            frame.columnconfigure(0, weight=1)
            builder(frame)
            frame.grid_remove()
            self.pages[name] = frame

    def show_page(self, name: str) -> None:
        if name not in self.pages:
            return
        for page in self.pages.values():
            page.grid_remove()
        self.current_page = name
        self.pages[name].grid()
        self.heading.configure(text=self.page_titles[name])
        self._render_page(name)

    def _form_fields(self, parent: tk.Misc, definitions: list[tuple[str, str, list[str] | None]], columns: int = 2) -> dict[str, FormField]:
        fields: dict[str, FormField] = {}
        for column in range(columns):
            parent.columnconfigure(column, weight=1, uniform=f"fields-{id(parent)}")
        for index, (key, label, choices) in enumerate(definitions):
            row, logical_column = divmod(index, columns)
            column = columns - logical_column - 1
            field = FormField(parent, label, choices=choices)
            field.grid(row=row, column=column, sticky="ew", padx=6, pady=6)
            fields[key] = field
        return fields

    @staticmethod
    def _actions(parent: tk.Misc, row: int, columns: int, actions: list[tuple[str, Callable[[], None], str]]) -> None:
        for column in range(columns):
            parent.columnconfigure(column, weight=1)
        frame = ttk.Frame(parent, style="Card.TFrame")
        frame.grid(row=row, column=0, columnspan=columns, sticky="ew", padx=6, pady=(8, 2))
        for index, (text, callback, style) in enumerate(actions):
            ttk.Button(frame, text=text, command=callback, style=style).pack(side="right", padx=(0, 8))

    def _build_dashboard(self, page: ttk.Frame) -> None:
        page.rowconfigure(99, weight=1)
        metrics = ttk.Frame(page)
        metrics.grid(row=0, column=0, sticky="ew", pady=(0, 14))
        self.metric_labels: dict[str, ttk.Label] = {}
        metric_titles = [
            ("warehouses", "المستودعات"),
            ("variants", "الأصناف"),
            ("units", "وحدات المخزون"),
            ("alerts", "تحت حد الطلب"),
        ]
        for column, (key, title) in enumerate(metric_titles):
            metrics.columnconfigure(column, weight=1, uniform="metric")
            panel = card(metrics, title)
            panel.grid(row=0, column=column, sticky="nsew", padx=6)
            label = ttk.Label(panel, text="0", style="Metric.TLabel", anchor="e")
            label.grid(row=0, column=0, sticky="ew", padx=8, pady=8)
            self.metric_labels[key] = label
        recent = card(page, "أحدث الحركات المخزنية")
        recent.grid(row=99, column=0, sticky="nsew")
        recent.rowconfigure(99, weight=1)
        self.dashboard_table = build_table(recent, [
            ("sku", "SKU", 180), ("warehouse", "المستودع", 110), ("type", "نوع الحركة", 150),
            ("qty", "الكمية", 90), ("date", "التاريخ", 180), ("notes", "ملاحظات", 240),
        ])

    def _build_inventory(self, page: ttk.Frame) -> None:
        page.rowconfigure(99, weight=1)
        panel = card(page, "بيانات الصنف")
        panel.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        self.variant_fields = self._form_fields(panel, [
            ("product_name", "اسم المنتج", None), ("brand", "العلامة التجارية", None),
            ("color", "اللون", None), ("size", "المقاس", None),
            ("sku", "SKU", None), ("barcode", "الباركود", None),
            ("cost", "متوسط التكلفة", None), ("reorder_point", "حد إعادة الطلب", None),
        ], columns=4)
        self._actions(panel, 2, 4, [
            ("حفظ الصنف", self._save_variant, "Accent.TButton"),
            ("تحديث المحدد", self._update_variant, "TButton"),
            ("حذف المحدد", self._delete_variant, "Danger.TButton"),
            ("مسح الحقول", lambda: self._clear_form("variant"), "TButton"),
        ])
        table_panel = card(page, "قائمة الأصناف والأرصدة")
        table_panel.grid(row=99, column=0, sticky="nsew")
        table_panel.rowconfigure(99, weight=1)
        self.variant_table = build_table(table_panel, [
            ("sku", "SKU", 170), ("product", "المنتج", 180), ("brand", "العلامة", 110),
            ("color", "اللون", 90), ("size", "المقاس", 80), ("on_hand", "فعلي", 80),
            ("reserved", "محجوز", 80), ("available", "متاح", 80), ("reorder", "حد الطلب", 90),
        ])
        self.variant_table.bind("<<TreeviewSelect>>", self._select_variant)

    def _build_locations(self, page: ttk.Frame) -> None:
        tabs = ttk.Notebook(page)
        tabs.grid(row=0, column=0, sticky="nsew")
        page.rowconfigure(0, weight=1)
        self.warehouse_page = ttk.Frame(tabs, padding=12)
        self.bin_page = ttk.Frame(tabs, padding=12)
        tabs.add(self.warehouse_page, text="المستودعات")
        tabs.add(self.bin_page, text="أماكن التخزين")
        self._build_warehouses(self.warehouse_page)
        self._build_bins(self.bin_page)

    def _build_warehouses(self, page: ttk.Frame) -> None:
        page.rowconfigure(99, weight=1)
        panel = card(page, "بيانات المستودع")
        panel.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        self.warehouse_fields = self._form_fields(panel, [
            ("code", "كود المستودع", None), ("name", "اسم المستودع", None),
            ("type", "النوع", ["main", "sub", "transit", "damaged", "showroom", "3pl", "office"]),
        ], columns=3)
        self._actions(panel, 1, 3, [
            ("حفظ المستودع", self._save_warehouse, "Accent.TButton"),
            ("تحديث المحدد", self._update_warehouse, "TButton"),
            ("حذف المحدد", self._delete_warehouse, "Danger.TButton"),
            ("مسح الحقول", lambda: self._clear_form("warehouse"), "TButton"),
        ])
        table_panel = card(page, "المستودعات المسجلة")
        table_panel.grid(row=99, column=0, sticky="nsew")
        table_panel.rowconfigure(99, weight=1)
        self.warehouse_table = build_table(table_panel, [
            ("code", "الكود", 150), ("name", "الاسم", 260), ("type", "النوع", 120), ("status", "الحالة", 100),
        ])
        self.warehouse_table.bind("<<TreeviewSelect>>", self._select_warehouse)

    def _build_bins(self, page: ttk.Frame) -> None:
        page.rowconfigure(99, weight=1)
        panel = card(page, "بيانات مكان التخزين")
        panel.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        self.bin_fields = self._form_fields(panel, [
            ("warehouse", "المستودع", []), ("zone", "المنطقة", None), ("aisle", "الممر", None),
            ("rack", "الرف", None), ("shelf", "الطبقة", None), ("bin", "الخانة", None),
            ("capacity_qty", "السعة", None),
        ], columns=4)
        self._actions(panel, 2, 4, [
            ("حفظ المكان", self._save_bin, "Accent.TButton"),
            ("تحديث المحدد", self._update_bin, "TButton"),
            ("حذف المحدد", self._delete_bin, "Danger.TButton"),
            ("مسح الحقول", lambda: self._clear_form("bin"), "TButton"),
        ])
        table_panel = card(page, "أماكن التخزين المسجلة")
        table_panel.grid(row=99, column=0, sticky="nsew")
        table_panel.rowconfigure(99, weight=1)
        self.bin_table = build_table(table_panel, [
            ("warehouse", "المستودع", 120), ("code", "كود المكان", 320),
            ("capacity", "السعة", 100), ("status", "الحالة", 100),
        ])
        self.bin_table.bind("<<TreeviewSelect>>", self._select_bin)

    def _build_movements(self, page: ttk.Frame) -> None:
        page.rowconfigure(99, weight=1)
        panel = card(page, "تسجيل حركة مخزنية")
        panel.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        self.movement_fields = self._form_fields(panel, [
            ("variant", "الصنف", []), ("warehouse", "المستودع", []),
            ("bin", "مكان التخزين (اختياري)", []), ("movement_type", "نوع الحركة", ["receipt", "issue", "sale", "transfer_in", "transfer_out", "reserve", "release", "return", "writeoff"]),
            ("qty", "الكمية", None), ("unit_cost", "تكلفة الوحدة", None),
            ("notes", "ملاحظات", None),
        ], columns=4)
        self._actions(panel, 2, 4, [
            ("تأكيد الحركة", self._record_movement, "Accent.TButton"),
            ("مسح الحقول", lambda: self._clear_form("movement"), "TButton"),
        ])
        table_panel = card(page, "سجل الحركات")
        table_panel.grid(row=99, column=0, sticky="nsew")
        table_panel.rowconfigure(99, weight=1)
        self.movement_table = build_table(table_panel, [
            ("sku", "SKU", 170), ("warehouse", "المستودع", 110), ("type", "النوع", 150),
            ("onhand", "تغير الفعلي", 100), ("reserved", "تغير المحجوز", 100),
            ("cost", "التكلفة", 100), ("date", "التاريخ", 180), ("notes", "ملاحظات", 240),
        ])

    def _build_stocktake(self, page: ttk.Frame) -> None:
        create = card(page, "إنشاء جلسة جرد")
        create.grid(row=0, column=0, sticky="ew", pady=(0, 12))
        self.stocktake_fields = self._form_fields(create, [
            ("warehouse", "المستودع", []), ("kind", "نوع الجرد", ["full", "cycle", "spot"]),
        ], columns=3)
        self._actions(create, 1, 3, [("إنشاء جلسة", self._create_stocktake, "Accent.TButton")])

        sessions_panel = card(page, "جلسات الجرد")
        sessions_panel.grid(row=1, column=0, sticky="ew", pady=(0, 10))
        self.session_table = build_table(sessions_panel, [
            ("warehouse", "المستودع", 130), ("kind", "النوع", 100), ("status", "الحالة", 110),
            ("lines", "عدد الأصناف", 100), ("counted", "تم رصدها", 100), ("created", "تاريخ الإنشاء", 180),
        ])
        sessions_panel.rowconfigure(99, weight=1)
        sessions_panel.configure(height=190)
        sessions_panel.grid_propagate(False)
        self.session_table.bind("<<TreeviewSelect>>", self._select_stocktake)

        controls = ttk.Frame(page)
        controls.grid(row=2, column=0, sticky="ew", pady=(0, 10))
        controls.columnconfigure(0, weight=1)
        count_panel = card(controls, "الكمية المرصودة للسطر المحدد")
        count_panel.pack(side="right", fill="x", expand=True, padx=(8, 0))
        self.count_field = FormField(count_panel, "الكمية الفعلية")
        self.count_field.grid(row=0, column=0, sticky="ew", padx=6, pady=6)
        ttk.Button(count_panel, text="حفظ الرصد", command=self._save_count, style="Accent.TButton").grid(row=0, column=1, padx=6)
        ttk.Button(controls, text="اعتماد التسوية", command=self._approve_stocktake, style="Accent.TButton").pack(side="right", padx=8, pady=12)

        lines_panel = card(page, "تفاصيل الجلسة المحددة")
        lines_panel.grid(row=3, column=0, sticky="nsew")
        page.rowconfigure(3, weight=1)
        lines_panel.rowconfigure(99, weight=1)
        self.stocktake_line_table = build_table(lines_panel, [
            ("sku", "SKU", 180), ("product", "المنتج", 180), ("book", "دفتري", 90),
            ("counted", "مرصود", 90), ("variance", "الفرق", 90), ("status", "الحالة", 110),
        ])
        self.stocktake_line_table.bind("<<TreeviewSelect>>", self._select_stocktake_line)

    def _build_audit(self, page: ttk.Frame) -> None:
        panel = card(page, "سجل العمليات")
        panel.grid(row=0, column=0, sticky="nsew")
        page.rowconfigure(0, weight=1)
        panel.rowconfigure(99, weight=1)
        self.audit_table = build_table(panel, [
            ("action", "العملية", 220), ("section", "القسم", 130),
            ("old", "القيمة السابقة", 260), ("new", "القيمة الجديدة", 300), ("created", "التاريخ", 190),
        ])

    def _run(self, work: Callable[[], Any], on_success: Callable[[Any], None] | None = None) -> None:
        set_status(self.status, "جار تنفيذ العملية...")
        future: Future[Any] = self.executor.submit(work)

        def completed(done: Future[Any]) -> None:
            try:
                result = done.result()
            except Exception as error:
                LOGGER.error("Background action failed: %s", error, exc_info=(type(error), error, error.__traceback__))
                self.events.put((None, error, True))
            else:
                self.events.put((on_success, result, False))

        future.add_done_callback(completed)

    def _drain_events(self) -> None:
        while not self.events.empty():
            try:
                callback, value, is_error = self.events.get_nowait()
            except queue.Empty:
                break
            if is_error:
                set_status(self.status, str(value), error=True)
                messagebox.showerror("تعذر تنفيذ العملية", str(value), parent=self)
            elif callback is not None:
                try:
                    callback(value)
                except Exception as error:
                    LOGGER.error("UI result callback failed: %s", error, exc_info=(type(error), error, error.__traceback__))
                    set_status(self.status, "تعذر تحديث الشاشة", error=True)
                    messagebox.showerror("تعذر تحديث الشاشة", str(error), parent=self)
        if self.winfo_exists():
            self.after(80, self._drain_events)

    def _refresh(self, _result: Any = None) -> None:
        self._run(self.database.load_workspace, self._apply_workspace)

    def _apply_workspace(self, workspace: dict[str, Any]) -> None:
        self.workspace = workspace
        set_status(self.status, f"متصل بقاعدة البيانات المحلية | {self.database.path.name}")
        self._render_page(self.current_page)
        self._update_selectors()

    def _render_page(self, name: str) -> None:
        if not self.workspace:
            return
        renderers = {
            "dashboard": self._render_dashboard,
            "inventory": self._render_inventory,
            "locations": self._render_locations,
            "movements": self._render_movements,
            "stocktake": self._render_stocktake,
            "audit": self._render_audit,
        }
        renderers[name]()

    @staticmethod
    def _fill(tree: ttk.Treeview, rows: list[dict[str, Any]], values: Callable[[dict[str, Any]], tuple[Any, ...]]) -> None:
        generation = getattr(tree, "_gs_render_generation", 0) + 1
        tree._gs_render_generation = generation  # type: ignore[attr-defined]
        data = list(rows)

        def render_batch(start: int = 0) -> None:
            if not tree.winfo_exists() or tree._gs_render_generation != generation:  # type: ignore[attr-defined]
                return
            end = min(start + 75, len(data))
            for row in data[start:end]:
                tree.insert("", "end", iid=str(row["id"]), values=values(row))
            if end < len(data):
                tree.after_idle(lambda: render_batch(end))

        def clear_batch() -> None:
            if not tree.winfo_exists() or tree._gs_render_generation != generation:  # type: ignore[attr-defined]
                return
            children = tree.get_children()
            if children:
                tree.delete(*children[:500])
                if len(children) > 500:
                    tree.after_idle(clear_batch)
                    return
            render_batch()

        clear_batch()

    def _render_dashboard(self) -> None:
        for key, value in self.workspace["dashboard"].items():
            self.metric_labels[key].configure(text=str(value))
        self._fill(self.dashboard_table, self.workspace["movements"], lambda row: (
            row["sku"], row["warehouse_code"], row["movement_type"],
            row["qty_onhand"] if row["qty_onhand"] else row["qty_reserved"], row["created_at"], row["notes"] or "",
        ))

    def _render_inventory(self) -> None:
        self._fill(self.variant_table, self.workspace["variants"], lambda row: (
            row["sku"], row["product_name"], row["brand"], row["color"], row["size"],
            row["on_hand"], row["reserved"], row["available"], row["reorder_point"],
        ))

    def _render_locations(self) -> None:
        self._fill(self.warehouse_table, self.workspace["warehouses"], lambda row: (
            row["code"], row["name"], row["type"], row["status"],
        ))
        self._fill(self.bin_table, self.workspace["bins"], lambda row: (
            row["warehouse_code"], row["code"], row["capacity_qty"], row["status"],
        ))

    def _render_movements(self) -> None:
        self._fill(self.movement_table, self.workspace["movements"], lambda row: (
            row["sku"], row["warehouse_code"], row["movement_type"], row["qty_onhand"],
            row["qty_reserved"], row["unit_cost"], row["created_at"], row["notes"] or "",
        ))

    def _render_stocktake(self) -> None:
        self._fill(self.session_table, self.workspace["sessions"], lambda row: (
            row["warehouse_code"], row["kind"], row["status"], row["line_count"],
            row["counted_lines"], row["created_at"],
        ))
        self._render_stocktake_lines()

    def _render_stocktake_lines(self) -> None:
        lines = self.workspace.get("stocktake_lines", [])
        if self.selected_stocktake_id is not None:
            lines = [row for row in lines if row["session_id"] == self.selected_stocktake_id]
        self._fill(self.stocktake_line_table, lines, lambda row: (
            row["sku"], row["product_name"], row["book_qty"],
            "" if row["counted_qty"] is None else row["counted_qty"],
            "" if row["variance_qty"] is None else row["variance_qty"], row["status"],
        ))

    def _render_audit(self) -> None:
        self._fill(self.audit_table, self.workspace["audit"], lambda row: (
            row["action_type"], row["section_name"], row["old_value"] or "", row["new_value"] or "", row["created_at"],
        ))

    def _update_selectors(self) -> None:
        warehouse_codes = [row["code"] for row in self.workspace["warehouses"]]
        variant_skus = [row["sku"] for row in self.workspace["variants"]]
        bin_codes = [row["code"] for row in self.workspace["bins"]]
        self.bin_fields["warehouse"].set_choices(warehouse_codes)
        self.movement_fields["warehouse"].set_choices(warehouse_codes)
        self.movement_fields["variant"].set_choices(variant_skus)
        self.movement_fields["bin"].set_choices([""] + bin_codes)
        self.stocktake_fields["warehouse"].set_choices(warehouse_codes)
        for fields, key in ((self.movement_fields, "warehouse"), (self.stocktake_fields, "warehouse")):
            if not fields[key].get() and warehouse_codes:
                fields[key].set(warehouse_codes[0])
        if warehouse_codes and not self.bin_fields["warehouse"].get():
            self.bin_fields["warehouse"].set(warehouse_codes[0])
        if variant_skus and not self.movement_fields["variant"].get():
            self.movement_fields["variant"].set(variant_skus[0])

    def _submit_mutation(self, operation: Callable[[], Any]) -> None:
        self._run(operation, self._refresh)

    def _save_warehouse(self) -> None:
        values = {key: field.get() for key, field in self.warehouse_fields.items()}
        self._submit_mutation(lambda: self.database.save_warehouse(values["code"], values["name"], values["type"] or "main"))

    def _update_warehouse(self) -> None:
        record_id = self.selected_ids["warehouse"]
        if record_id is None:
            messagebox.showinfo("تحديد مستودع", "حدد مستودعاً من الجدول أولاً", parent=self)
            return
        values = {key: field.get() for key, field in self.warehouse_fields.items()}
        self._submit_mutation(lambda: self.database.save_warehouse(values["code"], values["name"], values["type"] or "main", record_id))

    def _delete_warehouse(self) -> None:
        self._delete_selected("warehouse", self.database.delete_warehouse, "المستودع")

    def _save_bin(self) -> None:
        values = {key: field.get() for key, field in self.bin_fields.items()}
        warehouse = next((row for row in self.workspace["warehouses"] if row["code"] == values.pop("warehouse", "")), None)
        if warehouse is None:
            messagebox.showerror("بيانات ناقصة", "اختر مستودعاً صالحاً", parent=self)
            return
        values["warehouse_id"] = warehouse["id"]
        values["warehouse_code"] = warehouse["code"]
        self._submit_mutation(lambda: self.database.save_bin(values))

    def _update_bin(self) -> None:
        self._save_bin_with_id(self.selected_ids["bin"])

    def _save_bin_with_id(self, record_id: int | None) -> None:
        if record_id is None:
            messagebox.showinfo("تحديد مكان", "حدد مكان تخزين من الجدول أولاً", parent=self)
            return
        values = {key: field.get() for key, field in self.bin_fields.items()}
        warehouse = next((row for row in self.workspace["warehouses"] if row["code"] == values.pop("warehouse", "")), None)
        if warehouse is None:
            messagebox.showerror("بيانات ناقصة", "اختر مستودعاً صالحاً", parent=self)
            return
        values["warehouse_id"] = warehouse["id"]
        values["warehouse_code"] = warehouse["code"]
        self._submit_mutation(lambda: self.database.save_bin(values, record_id))

    def _delete_bin(self) -> None:
        self._delete_selected("bin", self.database.delete_bin, "مكان التخزين")

    def _save_variant(self) -> None:
        values = {key: field.get() for key, field in self.variant_fields.items()}
        self._submit_mutation(lambda: self.database.save_variant(values))

    def _update_variant(self) -> None:
        record_id = self.selected_ids["variant"]
        if record_id is None:
            messagebox.showinfo("تحديد صنف", "حدد صنفاً من الجدول أولاً", parent=self)
            return
        values = {key: field.get() for key, field in self.variant_fields.items()}
        self._submit_mutation(lambda: self.database.save_variant(values, record_id))

    def _delete_variant(self) -> None:
        self._delete_selected("variant", self.database.delete_variant, "الصنف")

    def _delete_selected(self, key: str, operation: Callable[[int], None], label: str) -> None:
        record_id = self.selected_ids[key]
        if record_id is None:
            messagebox.showinfo("تحديد سجل", f"حدد {label} من الجدول أولاً", parent=self)
            return
        if messagebox.askyesno("تأكيد الحذف", f"هل تريد حذف {label} المحدد؟", parent=self):
            self._submit_mutation(lambda: operation(record_id))

    def _record_movement(self) -> None:
        values = {key: field.get() for key, field in self.movement_fields.items()}
        variant = next((row for row in self.workspace["variants"] if row["sku"] == values["variant"]), None)
        warehouse = next((row for row in self.workspace["warehouses"] if row["code"] == values["warehouse"]), None)
        bin_row = next((row for row in self.workspace["bins"] if row["code"] == values["bin"]), None)
        if variant is None or warehouse is None:
            messagebox.showerror("بيانات ناقصة", "اختر صنفاً ومستودعاً صالحين", parent=self)
            return
        movement = {
            "variant_id": variant["id"], "warehouse_id": warehouse["id"],
            "bin_id": bin_row["id"] if bin_row else None,
            "movement_type": values["movement_type"], "qty": values["qty"],
            "unit_cost": values["unit_cost"] or variant["avg_cost"], "notes": values["notes"],
        }
        self._submit_mutation(lambda: self.database.record_movement(movement))

    def _create_stocktake(self) -> None:
        warehouse_code = self.stocktake_fields["warehouse"].get()
        warehouse = next((row for row in self.workspace["warehouses"] if row["code"] == warehouse_code), None)
        if warehouse is None:
            messagebox.showerror("بيانات ناقصة", "اختر مستودعاً صالحاً", parent=self)
            return
        self._submit_mutation(lambda: self.database.create_stocktake(warehouse["id"], self.stocktake_fields["kind"].get() or "full"))

    def _save_count(self) -> None:
        selection = self.stocktake_line_table.selection()
        if not selection:
            messagebox.showinfo("تحديد صنف", "حدد سطر جرد أولاً", parent=self)
            return
        try:
            count = int(self.count_field.get())
        except ValueError:
            messagebox.showerror("كمية غير صالحة", "أدخل كمية صحيحة", parent=self)
            return
        self._submit_mutation(lambda: self.database.set_stocktake_count(int(selection[0]), count))

    def _approve_stocktake(self) -> None:
        if self.selected_stocktake_id is None:
            messagebox.showinfo("تحديد جلسة", "حدد جلسة جرد من الجدول أولاً", parent=self)
            return
        if messagebox.askyesno("اعتماد الجرد", "سيتم تسجيل فروق الجرد كحركات مخزنية. هل تريد المتابعة؟", parent=self):
            self._submit_mutation(lambda: self.database.approve_stocktake(self.selected_stocktake_id))

    def _clear_form(self, name: str) -> None:
        field_sets = {
            "warehouse": self.warehouse_fields,
            "bin": self.bin_fields,
            "variant": self.variant_fields,
            "movement": self.movement_fields,
        }
        for field in field_sets[name].values():
            field.set("")
        if name in self.selected_ids:
            self.selected_ids[name] = None

    def _select_warehouse(self, _event: tk.Event[Any]) -> None:
        selection = self.warehouse_table.selection()
        if not selection:
            return
        record_id = int(selection[0])
        self.selected_ids["warehouse"] = record_id
        row = next(item for item in self.workspace["warehouses"] if item["id"] == record_id)
        for key in ("code", "name", "type"):
            self.warehouse_fields[key].set(row[key])

    def _select_bin(self, _event: tk.Event[Any]) -> None:
        selection = self.bin_table.selection()
        if not selection:
            return
        record_id = int(selection[0])
        self.selected_ids["bin"] = record_id
        row = next(item for item in self.workspace["bins"] if item["id"] == record_id)
        warehouse = next(item for item in self.workspace["warehouses"] if item["id"] == row["warehouse_id"])
        for key in ("warehouse", "zone", "aisle", "rack", "shelf", "bin", "capacity_qty"):
            value = warehouse["code"] if key == "warehouse" else row[key]
            self.bin_fields[key].set(value)

    def _select_variant(self, _event: tk.Event[Any]) -> None:
        selection = self.variant_table.selection()
        if not selection:
            return
        record_id = int(selection[0])
        self.selected_ids["variant"] = record_id
        row = next(item for item in self.workspace["variants"] if item["id"] == record_id)
        for key in ("product_name", "brand", "color", "size", "sku", "barcode", "avg_cost", "reorder_point"):
            field_key = "cost" if key == "avg_cost" else key
            self.variant_fields[field_key].set(row[key])

    def _select_stocktake(self, _event: tk.Event[Any]) -> None:
        selection = self.session_table.selection()
        self.selected_stocktake_id = int(selection[0]) if selection else None
        self._render_stocktake_lines()

    def _select_stocktake_line(self, _event: tk.Event[Any]) -> None:
        selection = self.stocktake_line_table.selection()
        if not selection:
            return
        row = next((item for item in self.workspace["stocktake_lines"] if item["id"] == int(selection[0])), None)
        if row:
            self.count_field.set(row["counted_qty"])

    def _close(self) -> None:
        self.executor.shutdown(wait=False, cancel_futures=True)
        self.destroy()


if __name__ == "__main__":
    logging.captureWarnings(True)
    ErpApp().mainloop()