# Business Rules Specification

## Systems Analysis and Design — Laboratory 4, Section A
### Role-Based Asset Transaction and Approval Management

---

### BR-A4-01: Available Equipment Requisition
- **Rule ID**: `BR-A4-01`
- **Rule Statement**: Only available equipment may be requested. The system must verify `equipment.status = 'Available'` before creating a request.
- **Implementation**:
  - *Client Layer (`js/borrowing.js`)*: Equipment selection dropdown queries only assets where `status === 'Available'`. Form validation blocks submission if chosen asset is not Available.
  - *Database Layer (`schema.sql`)*: Trigger `trg_check_equipment_availability` executes `check_equipment_before_request()` before INSERT into `borrowing_requests`. If `equipment.status != 'Available'`, it raises PostgreSQL exception `BR-A4-01 Violation: Only available equipment may be requested`.
- **Expected Behavior**: Borrowing request creation aborts with an informative error if the targeted equipment is Borrowed, Maintenance, Damaged, or Retired.
- **Example**: User attempts to request `PRJ-001` which is currently `Borrowed`. The system rejects the request immediately.

---

### BR-A4-02: Self-Approval Prevention
- **Rule ID**: `BR-A4-02`
- **Rule Statement**: Staff cannot approve their own request. A staff member or user must never be able to approve a borrowing request submitted by themselves.
- **Implementation**:
  - *Client Layer (`js/borrowing.js`)*: Approval function checks `if (req.requester_id === currentUserId) throw new Error(...)`.
  - *Database Layer (`schema.sql`)*: Inside `enforce_borrowing_state_machine()` trigger, on UPDATE of `borrowing_requests` to `Approved`: `IF auth.uid() = OLD.requester_id THEN RAISE EXCEPTION 'BR-A4-02 Violation: Staff cannot approve their own request'; END IF;`.
- **Expected Behavior**: Any attempt to self-approve is blocked and logged as an unauthorized action.
- **Example**: Administrator Maria Santos submits a borrowing request under her personal user account. When viewing the pending queue, self-approval is rejected by database constraints.

---

### BR-A4-03: Sole Administrator Approval Authority
- **Rule ID**: `BR-A4-03`
- **Rule Statement**: Only Administrator may approve or reject requests. If Staff or Requester attempts the operation, an "Access Denied" error is raised and no database modification occurs.
- **Implementation**:
  - *Client Layer (`js/permissions.js` & `js/borrowing.js`)*: Approval and rejection buttons are completely hidden from Staff and Requester interfaces. Direct invocation throws `Access Denied: Only Administrator may approve or reject requests`.
  - *Database Layer (`schema.sql` & `rls-policies.sql`)*: RLS policy on `borrowing_requests` restricts UPDATE on Pending rows to `is_admin()`. Trigger `enforce_borrowing_state_machine()` verifies `get_current_user_role() = 'administrator'`.
- **Expected Behavior**: Unauthorized role approval attempts result in `403 Access Denied` and automatic creation of an `ACCESS_DENIED` audit record.
- **Example**: Carlos Reyes (Laboratory Staff) executes a raw HTTP PATCH or JavaScript call attempting to approve Request `101`. Supabase rejects the operation with RLS policy violation.

---

### BR-A4-04: Release Precondition
- **Rule ID**: `BR-A4-04`
- **Rule Statement**: Only Approved requests may be released. The system must reject release attempts for `Pending`, `Rejected`, `Returned`, and `Closed` requests.
- **Implementation**:
  - *Client Layer (`js/borrowing.js`)*: `releaseEquipment()` validates `req.status === 'Approved'`.
  - *Database Layer (`schema.sql`)*: Trigger `enforce_borrowing_state_machine()` verifies `OLD.status = 'Approved'` before allowing transition to `Released`.
- **Expected Behavior**: The release operation fails with `Invalid State Transition: Only Approved requests can be released`.
- **Example**: Staff member attempts to release an asset for a student whose request is still in `Pending` review. The system blocks the release.

---

### BR-A4-05: Atomic Handover Transition
- **Rule ID**: `BR-A4-05`
- **Rule Statement**: Released equipment becomes Borrowed. When release succeeds, `borrowing_requests.status = 'Released'` and `equipment.status = 'Borrowed'` must be treated as one logical transaction.
- **Implementation**:
  - *Client Layer (`js/borrowing.js`)*: Dispatches atomic update via `rpc_release_equipment()` or unified localStorage commit.
  - *Database Layer (`schema.sql`)*: Trigger `trg_sync_equipment_on_release` executes after UPDATE on `borrowing_requests`:
    ```sql
    IF NEW.status = 'Released' AND OLD.status != 'Released' THEN
        UPDATE equipment SET status = 'Borrowed' WHERE id = NEW.equipment_id;
    END IF;
    ```
- **Expected Behavior**: Both tables update simultaneously in a single atomic database commit.
- **Example**: Staff releases `LAP-001`. `borrowing_requests` becomes `Released` and `LAP-001` becomes `Borrowed` in real time.

---

### BR-A4-06: Return Inspection & Availability Recovery
- **Rule ID**: `BR-A4-06`
- **Rule Statement**: Returned equipment becomes Available unless damaged. If returned in good condition, `equipment.status = 'Available'`. If damaged, `equipment.status = 'Damaged'`.
- **Implementation**:
  - *Client Layer (`js/borrowing.js`)*: Return inspection modal prompts staff to select condition (`Good`, `Fair`, `Damaged`).
  - *Database Layer (`schema.sql`)*: Function `rpc_process_return()` inspects condition parameter:
    ```sql
    IF lower(p_condition) = 'damaged' THEN
        v_new_status := 'Damaged';
    ELSE
        v_new_status := 'Available';
    END IF;
    UPDATE equipment SET status = v_new_status, condition = p_condition WHERE id = v_req.equipment_id;
    ```
- **Expected Behavior**: Damaged assets are flagged and quarantined from borrowing; functional assets are returned to the available inventory pool.
- **Example**: `OSC-001` is returned with cracked screen. Staff selects `Damaged`. Equipment status changes to `Damaged`, preventing new requests.

---

### BR-A4-07: Rejected Request Release Prohibition
- **Rule ID**: `BR-A4-07`
- **Rule Statement**: Rejected requests cannot be released. Block the operation at both JavaScript/interface level and Supabase/database level.
- **Implementation**:
  - *Client Layer (`js/borrowing.js`)*: `if (req.status === 'Rejected') throw new Error('BR-A4-07: Rejected requests cannot be released.');`.
  - *Database Layer (`schema.sql`)*: State machine trigger explicitly checks `IF OLD.status = 'Rejected' THEN RAISE EXCEPTION 'BR-A4-07 Violation: Rejected requests cannot be released or modified.'; END IF;`.
- **Expected Behavior**: Rejected transactions remain permanently closed.
- **Example**: Attempting to release rejected request `b0000000-0001-0000-0000-000000000004` raises a state transition error.

---

### BR-A4-08: Double Return Prevention
- **Rule ID**: `BR-A4-08`
- **Rule Statement**: Returned transactions cannot be processed twice. If `status = 'Returned'`, the return operation must be blocked.
- **Implementation**:
  - *Client Layer (`js/borrowing.js`)*: Checks `req.status === 'Returned' || req.status === 'Closed'` and rejects operation.
  - *Database Layer (`schema.sql`)*: State machine trigger verifies `IF OLD.status = 'Returned' THEN RAISE EXCEPTION 'BR-A4-08 Violation: Returned transactions cannot be processed twice'; END IF;`.
- **Expected Behavior**: Returns on already returned transactions are rejected with `Invalid Transaction State`.
- **Example**: Staff inadvertently clicks Return button on a transaction that another staff member already closed; system reports item is already returned.

---

### BR-A4-09: Maintenance Equipment Isolation
- **Rule ID**: `BR-A4-09`
- **Rule Statement**: Equipment under Maintenance cannot be borrowed. If `equipment.status = 'Maintenance'`, the borrowing request must fail.
- **Implementation**:
  - *Client Layer (`js/borrowing.js`)*: Dropdown omits maintenance items. Validation checks `if (equip.status === 'Maintenance') throw new Error(...)`.
  - *Database Layer (`schema.sql`)*: Trigger `trg_check_equipment_availability` checks `IF v_equip_status = 'Maintenance' THEN RAISE EXCEPTION 'BR-A4-09 Violation: Equipment under Maintenance cannot be borrowed'; END IF;`.
- **Expected Behavior**: Any attempt to submit a borrowing request for an asset in maintenance is strictly rejected.
- **Example**: `MON-001` is under repair for backlight flicker (`status = Maintenance`). Student Juan Dela Cruz cannot submit a request for it.

---

### BR-A4-10: Comprehensive Audit Logging
- **Rule ID**: `BR-A4-10`
- **Rule Statement**: Sensitive operations must be logged. System must audit at minimum: `LOGIN`, `LOGOUT`, `CREATE_USER`, `UPDATE_USER`, `CHANGE_USER_STATUS`, `CREATE_EQUIPMENT`, `UPDATE_EQUIPMENT`, `DELETE_EQUIPMENT`, `CREATE_BORROWING_REQUEST`, `APPROVED`, `REJECTED`, `RELEASED`, `RETURNED`, `MAINTENANCE_ACTION`, and `ACCESS_DENIED`.
- **Implementation**:
  - *Client Layer (`js/audit.js`)*: Unified `recordAuditEvent()` called at the completion of all state-altering functions.
  - *Database Layer (`schema.sql` & `rls-policies.sql`)*: Stored procedures automatically insert audit records. `audit_logs` table has no UPDATE or DELETE policies, making it permanently append-only and tamper-proof.
- **Expected Behavior**: Every sensitive event generates a timestamped log containing user, action, module, record ID, and description.
- **Example**: Maria Santos approves `LAP-001`. Audit record `APPROVED | Borrowing | Approved borrowing request for LAP-001` is created.
