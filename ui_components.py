from __future__ import annotations

import tkinter as tk
from tkinter import ttk
from typing import Iterable, Sequence


COLORS = {
    "background": "#0f172a",
    "surface": "#172033",
    "raised": "#1e293b",
    "border": "#334155",
    "text": "#e2e8f0",
    "muted": "#94a3b8",
    "accent": "#22d3ee",
    "accent_hover": "#38bdf8",
    "danger": "#fb7185",
    "success": "#34d399",
}


def configure_theme(root: tk.Misc) -> ttk.Style:
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except tk.TclError:
        style.theme_use("default")

    style.configure(".", background=COLORS["background"], foreground=COLORS["text"], font=("Segoe UI", 10))
    style.configure("TFrame", background=COLORS["background"])
    style.configure("Card.TFrame", background=COLORS["surface"])
    style.configure("Card.TLabelframe", background=COLORS["surface"], bordercolor=COLORS["border"])
    style.configure("Card.TLabelframe.Label", background=COLORS["surface"], foreground=COLORS["accent"], font=("Segoe UI", 10, "bold"))
    style.configure("TLabel", background=COLORS["background"], foreground=COLORS["text"])
    style.configure("Card.TLabel", background=COLORS["surface"], foreground=COLORS["text"])
    style.configure("Muted.TLabel", background=COLORS["surface"], foreground=COLORS["muted"])
    style.configure("Title.TLabel", font=("Segoe UI", 20, "bold"), foreground=COLORS["text"])
    style.configure("Metric.TLabel", font=("Segoe UI", 22, "bold"), foreground=COLORS["accent"])
    style.configure("TEntry", fieldbackground=COLORS["raised"], foreground=COLORS["text"], insertcolor=COLORS["text"], padding=(9, 8), bordercolor=COLORS["border"])
    style.configure("TCombobox", fieldbackground=COLORS["raised"], foreground=COLORS["text"], padding=(8, 7), arrowcolor=COLORS["accent"])
    style.map("TCombobox", fieldbackground=[("readonly", COLORS["raised"])], foreground=[("readonly", COLORS["text"])])
    style.configure("TButton", background=COLORS["raised"], foreground=COLORS["text"], padding=(12, 9), borderwidth=0)
    style.map("TButton", background=[("active", COLORS["border"])])
    style.configure("Accent.TButton", background=COLORS["accent"], foreground="#082f49", font=("Segoe UI", 10, "bold"), padding=(12, 9))
    style.map("Accent.TButton", background=[("active", COLORS["accent_hover"])])
    style.configure("Danger.TButton", background="#4c1d2b", foreground="#fecdd3", padding=(12, 9))
    style.map("Danger.TButton", background=[("active", "#881337")])
    style.configure("Treeview", background=COLORS["surface"], fieldbackground=COLORS["surface"], foreground=COLORS["text"], rowheight=32, bordercolor=COLORS["border"])
    style.configure("Treeview.Heading", background=COLORS["raised"], foreground=COLORS["accent"], font=("Segoe UI", 9, "bold"), padding=(8, 9))
    style.map("Treeview", background=[("selected", "#155e75")], foreground=[("selected", "#ecfeff")])
    style.configure("TNotebook", background=COLORS["background"], borderwidth=0)
    style.configure("TNotebook.Tab", background=COLORS["raised"], foreground=COLORS["text"], padding=(14, 9))
    style.map("TNotebook.Tab", background=[("selected", COLORS["accent"])], foreground=[("selected", "#082f49")])
    return style


class FormField(ttk.Frame):
    def __init__(
        self,
        parent: tk.Misc,
        label: str,
        *,
        choices: Sequence[str] | None = None,
        width: int = 20,
    ) -> None:
        super().__init__(parent, style="Card.TFrame")
        self.columnconfigure(0, weight=1)
        ttk.Label(self, text=label, style="Muted.TLabel", anchor="e").grid(row=0, column=0, sticky="ew", pady=(0, 5))
        if choices is None:
            self.variable = tk.StringVar()
            self.control: ttk.Entry | ttk.Combobox = ttk.Entry(self, textvariable=self.variable, width=width, justify="right")
        else:
            self.variable = tk.StringVar()
            self.control = ttk.Combobox(self, textvariable=self.variable, values=list(choices), width=width, state="readonly", justify="right")
        self.control.grid(row=1, column=0, sticky="ew")

    def get(self) -> str:
        return self.variable.get().strip()

    def set(self, value: object) -> None:
        self.variable.set("" if value is None else str(value))

    def set_choices(self, choices: Iterable[str]) -> None:
        if isinstance(self.control, ttk.Combobox):
            self.control.configure(values=list(choices))


def card(parent: tk.Misc, title: str) -> ttk.LabelFrame:
    frame = ttk.LabelFrame(parent, text=title, style="Card.TLabelframe", padding=14)
    frame.configure(labelanchor="ne")
    return frame


def build_table(parent: tk.Misc, columns: Sequence[tuple[str, str, int]]) -> ttk.Treeview:
    container = ttk.Frame(parent, style="Card.TFrame")
    container.grid(row=99, column=0, sticky="nsew")
    parent.rowconfigure(99, weight=1)
    parent.columnconfigure(0, weight=1)
    names = [name for name, _, _ in columns]
    tree = ttk.Treeview(container, columns=names, show="headings", selectmode="browse")
    for name, heading, width in columns:
        tree.heading(name, text=heading, anchor="e")
        tree.column(name, width=width, minwidth=70, anchor="e", stretch=True)
    vertical = ttk.Scrollbar(container, orient="vertical", command=tree.yview)
    horizontal = ttk.Scrollbar(container, orient="horizontal", command=tree.xview)
    tree.configure(yscrollcommand=vertical.set, xscrollcommand=horizontal.set)
    tree.grid(row=0, column=0, sticky="nsew")
    vertical.grid(row=0, column=1, sticky="ns")
    horizontal.grid(row=1, column=0, sticky="ew")
    container.rowconfigure(0, weight=1)
    container.columnconfigure(0, weight=1)
    tree.container = container  # type: ignore[attr-defined]
    return tree


def clear_table(tree: ttk.Treeview) -> None:
    children = tree.get_children()
    if children:
        tree.delete(*children)


def set_status(label: ttk.Label, text: str, *, error: bool = False) -> None:
    label.configure(text=text, foreground=COLORS["danger"] if error else COLORS["muted"])