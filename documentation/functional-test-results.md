# Functional Test Results

## Systems Analysis and Design — Laboratory 4, Section A
### Role-Based Asset Transaction and Approval Management

---

## 1. Test Summary

- **Total Test Cases Executed**: 15
- **Passed**: 15
- **Failed**: 0
- **Test Success Rate**: 100%
- **Execution Date**: 2026-09-15
- **Environment**: GitHub Pages / Static HTML5 + Vanilla JS + Supabase PostgreSQL RLS

---

## 2. Core Test Matrix (TC-A4-01 through TC-A4-10)

| Test ID | Scenario | Preconditions | Execution Steps | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-A4-01** | Viewer attempts to open Admin page | Logged in as `requester` (Juan Dela Cruz) | Navigate URL directly to `/pages/admin/users.html` | Client & RLS deny access; display 403 screen; log `ACCESS_DENIED` | Intercepted by `enforcePageGuard()`; 403 screen rendered; `ACCESS_DENIED` logged | **PASS** |
| **TC-A4-02** | Staff submits request | Logged in as `staff` (Carlos Reyes) | Fill borrowing form for `LAP-002`; click Submit | Request is saved in database with status `Pending` | Request created with `status = 'Pending'`; audit entry created | **PASS** |
| **TC-A4-03** | Administrator approves request | Logged in as `administrator` (Maria Santos) | Click **Approve** on Pending request `LAP-002` | Request status updates to `Approved`; audit log records approval | Status updated to `Approved`; approver set; `APPROVED` logged | **PASS** |
| **TC-A4-04** | Administrator rejects request | Logged in as `administrator` | Click **Reject** on Pending request; enter rejection reason | Request status becomes `Rejected`; reason stored; audit log written | Status set to `Rejected`; reason persisted; `REJECTED` logged | **PASS** |
| **TC-A4-05** | Attempt to release rejected request | Rejected request exists | Staff/Admin attempts release operation on rejected request | Operation blocked by state machine and RLS; error shown | Throws `BR-A4-07: Rejected requests cannot be released`; blocked | **PASS** |
| **TC-A4-06** | Release approved equipment | Request status is `Approved` | Click **Release Equipment** on approved request | Request becomes `Released`; equipment becomes `Borrowed` atomically | Atomic update succeeds; equipment marked `Borrowed`; `RELEASED` logged | **PASS** |
| **TC-A4-07** | Return released equipment | Transaction status is `Released` | Click **Process Return**; select condition `Good` | Request becomes `Returned`; equipment becomes `Available` | Request updated to `Returned`; equipment set to `Available`; `RETURNED` logged | **PASS** |
| **TC-A4-08** | Check audit log after approval | Request approved by Maria Santos | Navigate to `/pages/admin/audit-logs.html` | Approval entry `Maria Santos \| APPROVED \| Borrowing \| LAP-001` visible | Approval entry clearly visible in audit table with exact timestamp | **PASS** |
| **TC-A4-09** | Staff attempts restricted delete | Logged in as `staff` | Staff attempts to delete equipment via API/UI | Operation blocked; error displayed; no records deleted | Throws `Access Denied: You do not have permission to delete`; `ACCESS_DENIED` logged | **PASS** |
| **TC-A4-10** | Logout and open protected page | Logged in on dashboard | Click **Sign Out**; attempt to access `/dashboard.html` | Session destroyed; immediately redirected to `login.html` | Session cleared; route guard redirects to `login.html` | **PASS** |

---

## 3. Extended Security & Robustness Tests

| Test ID | Scenario | Preconditions | Execution Steps | Expected Result | Actual Result | Status |
| :--- | :--- | :--- | :--- | :--- | :--- | :---: |
| **TC-A4-11** | Invalid login credentials | None (on `login.html`) | Submit invalid password for `admin@gmail.com` | Authentication fails; error displayed; no session established | Error alert shown by Supabase Auth; session remains null | **PASS** |
| **TC-A4-12** | Deactivated account login | Account marked `inactive` in `profiles` | Attempt login with deactivated user credentials | Authentication rejected; error message displayed | Throws `Your account has been deactivated`; login blocked | **PASS** |
| **TC-A4-13** | Borrowing equipment under Maintenance (BR-A4-09) | `MON-001` status is `Maintenance` | Requester attempts to submit borrowing request for `MON-001` | Request blocked; validation error displayed | System prevents selection; database trigger throws BR-A4-09 exception | **PASS** |
| **TC-A4-14** | Duplicate return attempt (BR-A4-08) | Transaction status is `Returned` | Attempt to submit second return on same request ID | Operation rejected with `Invalid State`; no database update | Throws `BR-A4-08: Returned transactions cannot be processed twice` | **PASS** |
| **TC-A4-15** | Arbitrary state manipulation (BR-A4-04) | Request is `Pending` | Client attempts to force transition directly to `Released` | Transition rejected by database state trigger | Throws `Invalid State Transition: Pending can only transition to Approved/Rejected` | **PASS** |

---

## 4. Conclusion & Sign-Off

The system completely satisfies all security, role separation, and business rule specifications mandated by Laboratory 4, Section A. Dual-layer authorization guarantees that neither interface manipulation nor direct API invocation can compromise laboratory asset integrity.
