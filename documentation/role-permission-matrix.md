# Role-Permission Matrix Specification

## Systems Analysis and Design — Laboratory 4, Section A
### Role-Based Asset Transaction and Approval Management

---

## 1. Role-Permission Matrix

The following matrix formally defines the authorization envelope across all three system roles, enforced at both the client layer (`permissions.js`) and database engine layer (`rls-policies.sql` and PostgreSQL check triggers).

| System Function | Administrator | Laboratory Staff | Requester / Viewer | Enforced By |
| :--- | :---: | :---: | :---: | :--- |
| **Dashboard** | YES | YES | YES | Application Level (Role-tailored KPIs) |
| **View Equipment** | YES | YES | YES | RLS SELECT Policy on `equipment` |
| **Manage Equipment (Add/Edit)** | YES | NO | NO | RLS INSERT/UPDATE Policy on `equipment` |
| **Manage Users & Status** | YES | NO | NO | RLS UPDATE Policy on `profiles` |
| **Submit Borrowing Request** | YES | YES | YES | RLS INSERT Policy on `borrowing_requests` |
| **View Own Requests** | YES | YES | YES | RLS SELECT Policy (`requester_id = auth.uid()`) |
| **View All Requests** | YES | YES | NO | RLS SELECT Policy (`is_staff_or_admin()`) |
| **Approve Request** | YES | NO | NO | Database Trigger & RLS (`is_admin()`) |
| **Reject Request** | YES | NO | NO | Database Trigger & RLS (`is_admin()`) |
| **Release Equipment** | YES | YES | NO | Database Trigger & RPC (`is_staff_or_admin()`) |
| **Process Return** | YES | YES | NO | Database Trigger & RPC (`is_staff_or_admin()`) |
| **Submit Maintenance Request**| YES | YES | NO | RLS INSERT Policy on `maintenance` |
| **Manage Maintenance (Assign/Close)** | YES | NO | NO | RLS UPDATE Policy on `maintenance` |
| **Reports** | YES | LIMITED | NO | Application RBAC & Route Guard |
| **Audit Logs (View)** | YES | NO | NO | RLS SELECT Policy on `audit_logs` |
| **Restricted Delete** | YES | NO | NO | RLS DELETE Policies on all tables |

---

## 2. Security Rationale & Separation of Duties

### 2.1 Principle of Least Privilege (PoLP)
Every actor is granted only the minimum access rights essential for their academic or operational responsibilities:
- **Requesters** have no operational need to see other students' borrowing requests, hardware serial numbers, or laboratory staff assignments. Limiting them to their own records prevents academic surveillance, credential exploitation, and unauthorized equipment reservations.
- **Staff** have operational oversight (handover and return inspections) but cannot modify core catalog structures, delete inventory items, or alter user roles.

### 2.2 Separation of Duties (SoD)
1. **Approval Segregation (BR-A4-02 & BR-A4-03)**:
   - Laboratory Staff cannot approve borrowing requests, eliminating conflicts of interest where staff members might authorize requests for themselves or favored colleagues.
   - Only Administrators holding institutional fiduciary accountability can grant borrowing approvals.
2. **Restricted Deletion (TC-A4-09)**:
   - Deleting equipment or transactions removes historical audit evidence. Only Administrators may execute deletions, and even then, active borrowings cannot be deleted.
3. **Audit Log Immutability (BR-A4-10)**:
   - Audit logs are completely invisible to Staff and Requesters to avoid intelligence gathering on system monitoring patterns.
   - Audit logs cannot be updated or deleted by **any** user, including administrators, preserving an untampered forensic timeline.

---

## 3. Dual-Layer Security Architecture

### Application Level (Client Guard)
- Evaluated via `js/permissions.js` before UI rendering.
- Prevents unauthorized navigation, hides restricted action buttons, and intercepts manual URL manipulation (e.g. jumping directly to `/pages/admin/users.html`).
- Automatically logs `ACCESS_DENIED` whenever an unauthorized URL or function is triggered.

### Database Level (Row Level Security & Constraints)
- Evaluated directly inside PostgreSQL via Supabase Auth JWT tokens.
- Even if an attacker executes arbitrary queries via browser Developer Tools, PostgREST requests, or forged payloads, the database kernel rejects unauthorized queries with standard PostgreSQL permission denied errors.
