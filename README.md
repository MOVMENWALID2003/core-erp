# CORE ERP — نظام إدارة الموارد المتكامل

CORE ERP is an Arabic, right-to-left warehouse and inventory desktop application built with React, TypeScript, Vite, and Electron. Its scope is products, stock, warehouse locations, receipts, deliveries, internal transfers, physical counts, valuation, and audit history.

## Run the application

```powershell
npm install
npm run dev
```

Create and run a production Electron build:

```powershell
npm run build
npm start
```

Create the Windows NSIS installer and updater metadata:

```powershell
npm run dist
```

The installer artifacts are written to `dist_installer/`. The command bundles the Vite output with relative asset paths, Electron main/preload scripts, and the CORE ERP Windows icon. The NSIS installer allows choosing an install directory and creates Start Menu and desktop shortcuts. Installed builds check the public GitHub Releases page for updates at startup, download compatible stable updates in the background, and restart to install after a download completes. Development builds do not check for updates.

To publish a release, increment `version` in `package.json`, run `npm run dist`, and create a GitHub Release in `MOVMENWALID2003/core-erp` with a matching `v<version>` tag. Upload the generated `CORE ERP Setup <version>.exe`, `latest.yml`, and the matching `.blockmap` file from `dist_installer/`; publishing only the installer EXE will not provide the metadata required by the updater. Publish the release so installed apps can discover it. GitHub Releases is the update host; no separate paid update server is used. Windows builds are unsigned unless a code-signing certificate is configured.

The application stores business data locally in IndexedDB and does not synchronize inventory or user data to a cloud backend. The updater makes network requests only to check/download application releases from GitHub. Company logo images must be embedded locally; remote image URLs are not loaded. Existing browser `localStorage` state is migrated into IndexedDB on first launch, and JSON backup/restore remains available from the top bar. The UI shows a boot state while the local database is opened; a read/write failure is reported rather than silently treated as a successful save.

## Warehouse workflows

- **Products and scanning:** SKU/barcode lookup from the operation form supports keyboard-wedge scanners; lot, expiry, and serial details are validated when stock is posted.
- **Locations:** Multiple warehouses and hierarchical zone/aisle/rack/shelf/bin locations.
- **Put-away and picking:** Receipt and transfer destinations suggest active bins with enough remaining capacity. Deliveries build a pick route across available bins, prioritizing earliest-expiry lots (FEFO) and then the warehouse location path; pick allocations are posted to their actual bins.
- **Stock operations:** Receipts, deliveries, and internal transfers move through Draft → Waiting → Ready → Done. Only Done operations post ledger movements; insufficient stock prevents an outbound validation. Assigning an operator records completed units and execution time for the dashboard's seven-day efficiency KPIs.
- **Inventory:** On-hand, reserved, available, incoming, outgoing, and forecast quantities with search, filters, sorting, grouping, list/kanban modes, and CSV export for selected products. Authorized users can delete one or more products after confirmation; deletion also removes their variants and related stock/operation/count records while retaining the deletion audit entry. CSV and XLSX imports provide row validation and preview before one local IndexedDB save. The downloadable CSV template uses `name`, `model_code`, `sku`, `category`, `avg_cost`, and `initial_qty`; positive opening quantities are recorded as receipts in the active company's first warehouse.
- **Physical counts:** Full, cycle, and spot count lines are snapshotted by bin when a session is opened. All lines must be counted before approval posts discrepancies.
- **Reordering and KPIs:** Low-stock alerts are raised from reorder thresholds; the dashboard tracks inventory valuation, open operations, activity, and assigned operator throughput.
- **Valuation and audit:** Average-cost/FIFO reports and a persistent record of application actions.

## Employees and access rights

- The first launch initializes `admin@gserp.com` (username `admin`) with password `admin123`. Change this development password after first sign-in. The development build also provides a Quick Login button. Administrators can create employee accounts, assign one of the four security groups, set employment status, assign warehouses, and reset passwords or barcode PINs. Passwords and PINs are stored as salted PBKDF2-SHA-256 hashes; migrated demo accounts must have a password set before they can sign in.
- The group matrix defines read/create/write/delete/execute/approve/manage ACLs by application area. Warehouse-scoped groups are additionally restricted to their assigned warehouse records. Warehouse operators can execute receipts, deliveries, and transfers, but receipt valuation is held for administrator approval. Inventory auditors can enter count quantities, while approval remains restricted to administrators. Viewers have read-only dashboards, inventory, and reports.
- A configured barcode PIN is required when the signed-in user scans a SKU, barcode, or serial number in the operation form.
- These checks run in the local Electron renderer and its IndexedDB-backed state. They provide in-app role separation for this single-device application, but are not a server-side security boundary against a user who can modify the app or local database. A multi-user or adversarial deployment requires trusted server-side authentication, ACL enforcement, and record-rule enforcement.

## Companies and data scope

- The company selector switches among companies available to the signed-in user. Company settings include tax and address details, currency, logo URL, and a default warehouse. Creating a company also creates its main warehouse.
- Inventory views, stock operations, notifications, and CSV export are scoped to the active company, then further filtered by the user's assigned warehouses where applicable. Existing local records are normalized with company IDs when loaded.
- Company filters and local role checks run in the renderer and are not a security boundary. This local-only edition does not send data to a remote server; back up data regularly using the built-in JSON backup/restore controls.

The Python/Tkinter implementation (`py app.py`) and its SQLite data layer remain available as a separate desktop entry point. Its tests can be run with:

```powershell
py -m unittest -v test_database.py
```
