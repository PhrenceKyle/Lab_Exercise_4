# Laboratory Asset and Service Management System

### Module: Role-Based Asset Transaction and Approval Management
**Systems Analysis and Design — Laboratory Exercise 4, Section A**

A secure, responsive, role-based laboratory asset management system built with **HTML5, Vanilla CSS3, Vanilla JavaScript (ES6), and Supabase (PostgreSQL, Authentication, and Row Level Security)**, fully deployable to **GitHub Pages**.

---

## 🌟 Core System Features

- **Multi-Role Authentication & Access Control (RBAC)**:
  - Strict separation of duties between **Administrator**, **Laboratory Staff**, and **Requester / Viewer**.
  - Dual-layer security: Client-side route guards (`js/permissions.js`) and database-level Row Level Security (RLS) policies (`database/rls-policies.sql`).
- **End-to-End Equipment Lifecycle**:
  - Full hardware inventory tracking (`Available`, `Borrowed`, `Maintenance`, `Damaged`, `Retired`).
  - Serial number tracking, physical storage location mapping, and condition monitoring.
- **Transactional State-Machine Borrowing Workflow**:
  - Strict lifecycle: `Pending` &rarr; `Approved` / `Rejected` &rarr; `Released` &rarr; `Returned` &rarr; `Closed` (including `Overdue` handling).
  - Business rules BR-A4-01 through BR-A4-10 preventing invalid state transitions, self-approvals, and unauthorized handovers.
- **Hardware Maintenance & Quarantine Subsystem**:
  - Fault reporting flags defective assets into `Maintenance`, immediately locking them from borrowing.
  - Technician assignment and status tracking with automatic availability restoration upon completion.
- **Immutable Append-Only Audit Trail**:
  - Real-time forensic logging of logins, logouts, approvals, rejections, releases, returns, maintenance, and access violations.
  - Read-only table protected by database RLS.
- **Operational Dashboards & Analytics**:
  - Role-tailored KPI metric cards, equipment utilization rates, category distributions, and printable summary reports.

---

## 🛠️ Technology Architecture

```text
                    USER (Web Browser)
                            │
                            ▼
                   GitHub Pages Website
          (Static HTML5 + CSS3 + Vanilla JavaScript)
                            │
            ┌───────────────┴───────────────┐
            │                               │
    Application Layer             Supabase Client SDK
    - Session & RBAC Guard        - Supabase Auth (JWT)
    - Form Validations            - PostgreSQL REST (PostgREST)
    - Dynamic Sidebar & Modals    - RPC (Security Definers)
            │                               │
            └───────────────┬───────────────┘
                            ▼
                   Supabase Cloud / DB
          ┌─────────────────┼─────────────────┐
          │                 │                 │
     Supabase Auth     PostgreSQL DB     Row Level Security
    (auth.users)       - profiles        - Administrator
                       - equipment       - Laboratory Staff
                       - borrowing       - Requester / Viewer
                       - maintenance     - Audit Immutability
                       - audit_logs      - State Triggers
                            │
                            ▼
                    Audit Log Stream
          (BR-A4-10: All sensitive operations logged)
```

---

## 👥 Demo Test Credentials

The Supabase project should contain these Auth users and matching `profiles` records. Create or seed them in Supabase before signing in:

| Role | Name | Email | Default Password | Permissions Summary |
| :--- | :--- | :--- | :--- | :--- |
| **Administrator** | Maria Santos | `admin@gmail.com` | `admin123` | Full system control, user management, approve/reject requests, view audit logs, reports |
| **Laboratory Staff** | Carlos Reyes | `staff@gmail.com` | `staff123` | Equipment directory, dispatch releases, process returns, submit maintenance tickets |
| **Requester / Viewer** | Juan Dela Cruz | `requester@gmail.com` | `requester123` | Browse available catalog, submit borrowing requests, track active requests and history |
| **Requester 2** | Ana Lim | `ana@lab.edu` | Set in Supabase Auth | Student borrower account |

---

## 📂 Project Directory Structure

```text
laboratory-asset-system/
├── index.html                    # Entry redirector and splash page
├── login.html                    # Authentication portal with demo quick-fill
├── dashboard.html                # Centralized role-tailored dashboard
│
├── pages/
│   ├── admin/
│   │   ├── users.html            # Profile administration & active status toggling
│   │   ├── equipment.html        # Hardware inventory CRUD & status management
│   │   ├── borrowing.html        # Approval center (Approve, Reject, Release)
│   │   ├── maintenance.html      # Work order management & technician assignments
│   │   ├── reports.html          # Asset utilization analytics & PDF export
│   │   └── audit-logs.html       # Immutable audit trail with multi-filtering
│   │
│   ├── staff/
│   │   ├── equipment.html        # Staff equipment catalog
│   │   ├── borrowing.html        # Operational borrowings & equipment releases
│   │   ├── returns.html          # Hardware inspection & return processing
│   │   └── maintenance.html      # Submit maintenance issues
│   │
│   └── requester/
│       ├── equipment.html        # Available equipment directory
│       ├── request.html          # Equipment requisition form
│       ├── my-requests.html      # Active request status tracker
│       └── history.html          # Completed borrowing history
│
├── css/
│   ├── style.css                 # Design tokens, typography, badges, modals, toasts
│   ├── dashboard.css             # Sidebar layout, top header, KPI metric cards, tables
│   ├── forms.css                 # Form inputs, validation states, login portal styles
│   └── responsive.css            # Tablet collapse, mobile drawer, print stylesheet
│
├── js/
│   ├── supabase.js               # Supabase client & fallback offline demo adapter
│   ├── auth.js                   # Login, logout, session persistence
│   ├── session.js                # Current user profile and session store
│   ├── permissions.js            # RBAC matrix & client-side route guard (403 handler)
│   ├── dashboard.js              # KPI metric aggregators per role
│   ├── equipment.js              # Equipment CRUD, availability rules & filters
│   ├── borrowing.js              # State-machine workflow engine (BR-01 to BR-09)
│   ├── maintenance.js            # Maintenance ticket creation & sync
│   ├── audit.js                  # Append-only audit logger & viewer
│   ├── users.js                  # User account management
│   ├── reports.js                # Utilization analytics & print layout
│   ├── ui.js                     # Toasts, accessible modals, dynamic navigation
│   └── app.js                    # Master application bootstrapper
│
├── database/
│   ├── schema.sql                # Complete PostgreSQL schema, check constraints, triggers
│   ├── rls-policies.sql          # Supabase Row Level Security (RLS) policies
│   └── seed.sql                  # Initial seed dataset with realistic assets & logs
│
├── documentation/
│   ├── erd.md                    # Entity-Relationship Diagram specification
│   ├── use-case.md               # Actor definitions & detailed use cases
│   ├── role-permission-matrix.md # Full RBAC matrix & security rationale
│   ├── workflow.md               # Complete transaction lifecycle & state charts
│   ├── business-rules.md         # In-depth specification of BR-A4-01 to BR-A4-10
│   └── functional-test-results.md# Test execution results for TC-A4-01 to TC-A4-15
│
├── screenshots/
│   ├── admin-dashboard.png       # Administrator overview & KPI cards
│   ├── audit-log.png             # Approval audit entry demonstration
│   └── test-results.png          # Functional test pass visual proof
│
├── .gitignore                    # Git exclusions
└── README.md                     # System documentation & setup guide
```

---

## 🚀 Setup & Installation Guide

### Connecting to Live Supabase Backend
1. **Create Supabase Project**:
   - Go to [Supabase](https://supabase.com/) and create a new project.
2. **Execute Database Scripts**:
   - In your Supabase Dashboard, open the **SQL Editor**.
   - Copy and execute `database/schema.sql`.
   - Copy and execute `database/rls-policies.sql`.
   - Copy and execute `database/seed.sql` to populate sample users, profiles, equipment, transactions, and audit records.
3. **Configure Authentication**:
   - Under **Authentication &rarr; Providers**, ensure **Email** is enabled.
   - Disable email confirmations if you wish users to sign in immediately without verifying email.
4. **Connect Frontend**:
   - In the application top header, click **⚡ Connect Supabase** if the configured project needs to be changed.
   - Enter your **Project URL** and **Publishable/Anon Public Key** from Project Settings &rarr; API.
   - Click **Save & Connect**. The application will reload and bind to the live PostgreSQL database.
3. Sign in through Supabase Auth using one of the accounts listed above.

> [!IMPORTANT]
> Never expose your `SUPABASE_SERVICE_ROLE_KEY` in the browser or commit it to GitHub. The application operates exclusively with the safe publishable `anon` key, backed by PostgreSQL Row Level Security (RLS).

---

## 🌐 Deploying to GitHub Pages

1. Initialize Git repository and commit all project files:
   ```bash
   git init
   git add .
   git commit -m "feat: complete Laboratory Asset Management System with RLS and documentation"
   ```
2. Create a public repository on GitHub (e.g. `laboratory-asset-system`).
3. Link and push your code:
   ```bash
   git remote add origin https://github.com/<your-username>/laboratory-asset-system.git
   git branch -M main
   git push -u origin main
   ```
4. Enable GitHub Pages:
   - Navigate to repository **Settings &rarr; Pages**.
   - Under **Build and deployment &rarr; Branch**, select `main` branch and `/ (root)` folder.
   - Click **Save**.
5. Your live application will be published at:
   `https://<your-username>.github.io/laboratory-asset-system/`

All relative paths (`./css/`, `../../js/app.js`) have been engineered to function seamlessly under repository subpaths without path breakage.

---

## 📜 Business Rules Reference (BR-A4-01 through BR-A4-10)

- **BR-A4-01**: Only Available equipment may be requested.
- **BR-A4-02**: Staff cannot approve their own request.
- **BR-A4-03**: Only Administrator may approve or reject requests.
- **BR-A4-04**: Only Approved requests may be released.
- **BR-A4-05**: Released equipment atomically becomes Borrowed.
- **BR-A4-06**: Returned equipment becomes Available unless damaged (becomes Damaged).
- **BR-A4-07**: Rejected requests cannot be released.
- **BR-A4-08**: Returned transactions cannot be processed twice.
- **BR-A4-09**: Equipment under Maintenance cannot be borrowed.
- **BR-A4-10**: All sensitive operations are logged to the immutable audit trail.

---

## 📄 Documentation Links

- [Entity-Relationship Diagram](documentation/erd.md)
- [Use Case Specification](documentation/use-case.md)
- [Role-Permission Matrix](documentation/role-permission-matrix.md)
- [Transaction Lifecycle & State Transitions](documentation/workflow.md)
- [Detailed Business Rules Specification](documentation/business-rules.md)
- [Functional Test Results (TC-A4-01 through TC-A4-15)](documentation/functional-test-results.md)
