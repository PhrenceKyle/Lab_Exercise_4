-- =====================================================================
-- LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
-- Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
-- Database Schema (PostgreSQL / Supabase)
-- =====================================================================

-- Enable pgcrypto for UUID generation if needed
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Drop existing objects in reverse order of dependencies (clean setup)
DROP TRIGGER IF EXISTS trg_audit_profiles ON profiles;
DROP TRIGGER IF EXISTS trg_audit_equipment ON equipment;
DROP TRIGGER IF EXISTS trg_audit_borrowing ON borrowing_requests;
DROP TRIGGER IF EXISTS trg_audit_maintenance ON maintenance;
DROP TRIGGER IF EXISTS trg_borrowing_state_machine ON borrowing_requests;
DROP TRIGGER IF EXISTS trg_check_equipment_availability ON borrowing_requests;
DROP TRIGGER IF EXISTS trg_sync_equipment_on_release ON borrowing_requests;
DROP TRIGGER IF EXISTS trg_sync_equipment_on_return ON borrowing_requests;
DROP TRIGGER IF EXISTS trg_sync_equipment_on_maintenance ON maintenance;

DROP TABLE IF EXISTS audit_logs CASCADE;
DROP TABLE IF EXISTS maintenance CASCADE;
DROP TABLE IF EXISTS borrowing_requests CASCADE;
DROP TABLE IF EXISTS equipment CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;

-- ---------------------------------------------------------------------
-- 1. PROFILES TABLE (Application-level user info tied to auth.users)
-- ---------------------------------------------------------------------
CREATE TABLE profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('administrator', 'staff', 'requester')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for role lookup and performance
CREATE INDEX idx_profiles_role ON profiles(role);
CREATE INDEX idx_profiles_email ON profiles(email);

-- ---------------------------------------------------------------------
-- 2. EQUIPMENT TABLE
-- ---------------------------------------------------------------------
CREATE TABLE equipment (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    asset_code TEXT UNIQUE NOT NULL,
    equipment_name TEXT NOT NULL,
    category TEXT NOT NULL,
    description TEXT,
    location TEXT NOT NULL,
    quantity INT NOT NULL DEFAULT 1,
    condition TEXT NOT NULL DEFAULT 'Good',
    status TEXT NOT NULL DEFAULT 'Available' CHECK (status IN ('Available', 'Borrowed', 'Maintenance', 'Damaged', 'Retired')),
    serial_number TEXT,
    acquisition_date DATE DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_equipment_status ON equipment(status);
CREATE INDEX idx_equipment_category ON equipment(category);
CREATE INDEX idx_equipment_asset_code ON equipment(asset_code);

-- ---------------------------------------------------------------------
-- 3. BORROWING REQUESTS TABLE
-- ---------------------------------------------------------------------
CREATE TABLE borrowing_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    requester_id UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
    purpose TEXT NOT NULL,
    request_date DATE NOT NULL DEFAULT CURRENT_DATE,
    expected_return_date DATE NOT NULL,
    approved_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
    approved_at TIMESTAMPTZ,
    rejected_reason TEXT,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Released', 'Returned', 'Overdue', 'Closed')),
    released_at TIMESTAMPTZ,
    returned_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_borrowing_status ON borrowing_requests(status);
CREATE INDEX idx_borrowing_requester ON borrowing_requests(requester_id);
CREATE INDEX idx_borrowing_equipment ON borrowing_requests(equipment_id);

-- ---------------------------------------------------------------------
-- 4. MAINTENANCE TABLE
-- ---------------------------------------------------------------------
CREATE TABLE maintenance (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    equipment_id UUID NOT NULL REFERENCES equipment(id) ON DELETE RESTRICT,
    requested_by UUID NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
    assigned_to UUID REFERENCES profiles(id) ON DELETE SET NULL,
    problem_description TEXT NOT NULL,
    maintenance_date DATE NOT NULL DEFAULT CURRENT_DATE,
    status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'In Progress', 'Completed', 'Cancelled')),
    remarks TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_maintenance_status ON maintenance(status);
CREATE INDEX idx_maintenance_equipment ON maintenance(equipment_id);

-- ---------------------------------------------------------------------
-- 5. AUDIT LOGS TABLE (Read-Only Trail)
-- ---------------------------------------------------------------------
CREATE TABLE audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    module TEXT NOT NULL,
    record_id TEXT,
    description TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_module ON audit_logs(module);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- =====================================================================
-- DATABASE FUNCTIONS & TRIGGERS FOR BUSINESS RULES (BR-01 through BR-10)
-- =====================================================================

-- Helper: Get current user role
CREATE OR REPLACE FUNCTION get_current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT role FROM profiles WHERE id = auth.uid();
$$;

-- Helper: Update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_profiles_updated_at BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_equipment_updated_at BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_borrowing_updated_at BEFORE UPDATE ON borrowing_requests FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER trg_maintenance_updated_at BEFORE UPDATE ON maintenance FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ---------------------------------------------------------------------
-- BR-A4-01 & BR-A4-09: Equipment availability verification before request
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION check_equipment_before_request()
RETURNS TRIGGER AS $$
DECLARE
    v_equip_status TEXT;
BEGIN
    SELECT status INTO v_equip_status FROM equipment WHERE id = NEW.equipment_id;

    IF v_equip_status IS NULL THEN
        RAISE EXCEPTION 'Equipment not found.';
    END IF;

    IF v_equip_status = 'Maintenance' THEN
        RAISE EXCEPTION 'BR-A4-09 Violation: Equipment under Maintenance cannot be borrowed.';
    END IF;

    IF v_equip_status != 'Available' THEN
        RAISE EXCEPTION 'BR-A4-01 Violation: Only available equipment may be requested (Current status: %).', v_equip_status;
    END IF;

    -- Force initial status to Pending
    NEW.status := 'Pending';
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_equipment_availability
BEFORE INSERT ON borrowing_requests
FOR EACH ROW EXECUTE FUNCTION check_equipment_before_request();

-- ---------------------------------------------------------------------
-- BR-A4-02, BR-A4-03, BR-A4-04, BR-A4-07, BR-A4-08: State Transition Control
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION enforce_borrowing_state_machine()
RETURNS TRIGGER AS $$
DECLARE
    v_user_role TEXT;
BEGIN
    -- Only check on status update
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    v_user_role := get_current_user_role();

    -- Rule: Pending -> Approved or Rejected
    IF OLD.status = 'Pending' THEN
        IF NEW.status NOT IN ('Approved', 'Rejected') THEN
            RAISE EXCEPTION 'Invalid State Transition: Pending requests can only transition to Approved or Rejected.';
        END IF;

        -- BR-A4-03: Only Administrator may approve or reject
        IF v_user_role IS NOT NULL AND v_user_role != 'administrator' THEN
            RAISE EXCEPTION 'BR-A4-03 Violation: Access Denied. Only Administrator may approve or reject requests.';
        END IF;

        -- BR-A4-02: Staff cannot approve their own request
        IF NEW.status = 'Approved' AND auth.uid() = OLD.requester_id THEN
            RAISE EXCEPTION 'BR-A4-02 Violation: Staff cannot approve their own request.';
        END IF;

        IF NEW.status = 'Approved' THEN
            NEW.approved_by := COALESCE(NEW.approved_by, auth.uid());
            NEW.approved_at := COALESCE(NEW.approved_at, now());
        END IF;

        IF NEW.status = 'Rejected' AND (NEW.rejected_reason IS NULL OR trim(NEW.rejected_reason) = '') THEN
            RAISE EXCEPTION 'Rejection reason is required when rejecting a request.';
        END IF;

    -- Rule: Approved -> Released
    ELSIF OLD.status = 'Approved' THEN
        IF NEW.status != 'Released' THEN
            RAISE EXCEPTION 'Invalid State Transition: Approved requests can only transition to Released.';
        END IF;

        -- BR-A4-04: Only approved requests may be released (Staff or Admin can release)
        IF v_user_role IS NOT NULL AND v_user_role NOT IN ('administrator', 'staff') THEN
            RAISE EXCEPTION 'BR-A4-04 Violation: Access Denied. Only Administrator or Laboratory Staff can release equipment.';
        END IF;

        NEW.released_at := COALESCE(NEW.released_at, now());

    -- Rule: Rejected -> Cannot transition
    ELSIF OLD.status = 'Rejected' THEN
        RAISE EXCEPTION 'BR-A4-07 Violation: Rejected requests cannot be released or modified.';

    -- Rule: Released -> Returned or Overdue
    ELSIF OLD.status = 'Released' THEN
        IF NEW.status NOT IN ('Returned', 'Overdue') THEN
            RAISE EXCEPTION 'Invalid State Transition: Released transactions can only transition to Returned or Overdue.';
        END IF;

        IF NEW.status = 'Returned' THEN
            NEW.returned_at := COALESCE(NEW.returned_at, now());
        END IF;

    -- Rule: Overdue -> Returned
    ELSIF OLD.status = 'Overdue' THEN
        IF NEW.status != 'Returned' THEN
            RAISE EXCEPTION 'Invalid State Transition: Overdue transactions can only transition to Returned.';
        END IF;
        NEW.returned_at := COALESCE(NEW.returned_at, now());

    -- Rule: Returned -> Closed
    ELSIF OLD.status = 'Returned' THEN
        IF NEW.status != 'Closed' THEN
            -- BR-A4-08: Returned transactions cannot be processed twice
            RAISE EXCEPTION 'BR-A4-08 Violation: Returned transactions cannot be returned again or transitioned to %.', NEW.status;
        END IF;
        NEW.closed_at := COALESCE(NEW.closed_at, now());

    -- Rule: Closed -> Terminal
    ELSIF OLD.status = 'Closed' THEN
        RAISE EXCEPTION 'Invalid State Transition: Closed transactions cannot be modified.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_borrowing_state_machine
BEFORE UPDATE ON borrowing_requests
FOR EACH ROW EXECUTE FUNCTION enforce_borrowing_state_machine();

-- ---------------------------------------------------------------------
-- BR-A4-05: Released equipment becomes Borrowed (Atomic Synchronization)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_equipment_on_release()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status = 'Released' AND OLD.status != 'Released' THEN
        UPDATE equipment
        SET status = 'Borrowed', updated_at = now()
        WHERE id = NEW.equipment_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_sync_equipment_on_release
AFTER UPDATE ON borrowing_requests
FOR EACH ROW EXECUTE FUNCTION sync_equipment_on_release();

-- ---------------------------------------------------------------------
-- Maintenance Equipment Status Synchronization
-- When maintenance is created or in progress, equipment status becomes Maintenance
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_equipment_on_maintenance()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND NEW.status IN ('Pending', 'In Progress')) THEN
        UPDATE equipment
        SET status = 'Maintenance', updated_at = now()
        WHERE id = NEW.equipment_id;
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'Completed' THEN
        UPDATE equipment
        SET status = 'Available', updated_at = now()
        WHERE id = NEW.equipment_id;
    ELSIF TG_OP = 'UPDATE' AND NEW.status = 'Cancelled' THEN
        UPDATE equipment
        SET status = 'Available', updated_at = now()
        WHERE id = NEW.equipment_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER trg_sync_equipment_on_maintenance
AFTER INSERT OR UPDATE ON maintenance
FOR EACH ROW EXECUTE FUNCTION sync_equipment_on_maintenance();

-- ---------------------------------------------------------------------
-- RPC: Approve Request (BR-A4-03, BR-A4-10)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_approve_request(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_req RECORD;
    v_role TEXT;
    v_admin_name TEXT;
BEGIN
    v_role := get_current_user_role();
    IF v_role != 'administrator' THEN
        -- Log unauthorized attempt
        INSERT INTO audit_logs (user_id, action, module, record_id, description)
        VALUES (auth.uid(), 'ACCESS_DENIED', 'Borrowing', p_request_id::TEXT, 'Unauthorized attempt to approve borrowing request');
        RAISE EXCEPTION 'Access Denied: Only Administrator may approve requests.';
    END IF;

    SELECT b.*, e.asset_code INTO v_req
    FROM borrowing_requests b
    JOIN equipment e ON e.id = b.equipment_id
    WHERE b.id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    IF v_req.status != 'Pending' THEN
        RAISE EXCEPTION 'Only Pending requests can be approved.';
    END IF;

    -- Update borrowing request
    UPDATE borrowing_requests
    SET status = 'Approved',
        approved_by = auth.uid(),
        approved_at = now(),
        updated_at = now()
    WHERE id = p_request_id;

    SELECT full_name INTO v_admin_name FROM profiles WHERE id = auth.uid();

    -- Audit log
    INSERT INTO audit_logs (user_id, action, module, record_id, description)
    VALUES (
        auth.uid(),
        'APPROVED',
        'Borrowing',
        p_request_id::TEXT,
        format('Approved borrowing request for %s', v_req.asset_code)
    );

    RETURN jsonb_build_object('success', true, 'message', 'Request approved successfully.');
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: Reject Request (BR-A4-03, BR-A4-10)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_reject_request(p_request_id UUID, p_reason TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_req RECORD;
    v_role TEXT;
BEGIN
    v_role := get_current_user_role();
    IF v_role != 'administrator' THEN
        INSERT INTO audit_logs (user_id, action, module, record_id, description)
        VALUES (auth.uid(), 'ACCESS_DENIED', 'Borrowing', p_request_id::TEXT, 'Unauthorized attempt to reject borrowing request');
        RAISE EXCEPTION 'Access Denied: Only Administrator may reject requests.';
    END IF;

    IF p_reason IS NULL OR trim(p_reason) = '' THEN
        RAISE EXCEPTION 'Rejection reason is required.';
    END IF;

    SELECT b.*, e.asset_code INTO v_req
    FROM borrowing_requests b
    JOIN equipment e ON e.id = b.equipment_id
    WHERE b.id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    IF v_req.status != 'Pending' THEN
        RAISE EXCEPTION 'Only Pending requests can be rejected.';
    END IF;

    UPDATE borrowing_requests
    SET status = 'Rejected',
        rejected_reason = p_reason,
        updated_at = now()
    WHERE id = p_request_id;

    INSERT INTO audit_logs (user_id, action, module, record_id, description)
    VALUES (
        auth.uid(),
        'REJECTED',
        'Borrowing',
        p_request_id::TEXT,
        format('Rejected borrowing request for %s. Reason: %s', v_req.asset_code, p_reason)
    );

    RETURN jsonb_build_object('success', true, 'message', 'Request rejected.');
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: Release Equipment (BR-A4-04, BR-A4-05, BR-A4-10)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_release_equipment(p_request_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_req RECORD;
    v_role TEXT;
BEGIN
    v_role := get_current_user_role();
    IF v_role NOT IN ('administrator', 'staff') THEN
        INSERT INTO audit_logs (user_id, action, module, record_id, description)
        VALUES (auth.uid(), 'ACCESS_DENIED', 'Borrowing', p_request_id::TEXT, 'Unauthorized attempt to release equipment');
        RAISE EXCEPTION 'Access Denied: Only Administrator or Staff can release equipment.';
    END IF;

    SELECT b.*, e.asset_code, e.status AS equip_status INTO v_req
    FROM borrowing_requests b
    JOIN equipment e ON e.id = b.equipment_id
    WHERE b.id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    -- BR-A4-04 & BR-A4-07: Only Approved requests may be released
    IF v_req.status != 'Approved' THEN
        RAISE EXCEPTION 'BR-A4-04 Violation: Only Approved requests may be released. Current status: %', v_req.status;
    END IF;

    -- Atomic transition: request becomes Released, equipment becomes Borrowed
    UPDATE borrowing_requests
    SET status = 'Released',
        released_at = now(),
        updated_at = now()
    WHERE id = p_request_id;

    UPDATE equipment
    SET status = 'Borrowed',
        updated_at = now()
    WHERE id = v_req.equipment_id;

    INSERT INTO audit_logs (user_id, action, module, record_id, description)
    VALUES (
        auth.uid(),
        'RELEASED',
        'Borrowing',
        p_request_id::TEXT,
        format('Released %s to requester', v_req.asset_code)
    );

    RETURN jsonb_build_object('success', true, 'message', 'Equipment released successfully.');
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: Process Return (BR-A4-06, BR-A4-08, BR-A4-10)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_process_return(
    p_request_id UUID,
    p_condition TEXT DEFAULT 'Good',
    p_remarks TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_req RECORD;
    v_role TEXT;
    v_new_equip_status TEXT;
BEGIN
    v_role := get_current_user_role();
    IF v_role NOT IN ('administrator', 'staff') THEN
        INSERT INTO audit_logs (user_id, action, module, record_id, description)
        VALUES (auth.uid(), 'ACCESS_DENIED', 'Returns', p_request_id::TEXT, 'Unauthorized attempt to process return');
        RAISE EXCEPTION 'Access Denied: Only Administrator or Staff can process returns.';
    END IF;

    SELECT b.*, e.asset_code INTO v_req
    FROM borrowing_requests b
    JOIN equipment e ON e.id = b.equipment_id
    WHERE b.id = p_request_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Request not found.';
    END IF;

    -- BR-A4-08: Cannot process already returned transaction
    IF v_req.status = 'Returned' THEN
        RAISE EXCEPTION 'BR-A4-08 Violation: This transaction has already been returned.';
    END IF;

    IF v_req.status NOT IN ('Released', 'Overdue') THEN
        RAISE EXCEPTION 'Only Released or Overdue transactions can be returned. Current status: %', v_req.status;
    END IF;

    -- BR-A4-06: Returned equipment becomes Available unless damaged
    IF lower(p_condition) = 'damaged' THEN
        v_new_equip_status := 'Damaged';
    ELSE
        v_new_equip_status := 'Available';
    END IF;

    -- Atomic transition
    UPDATE borrowing_requests
    SET status = 'Returned',
        returned_at = now(),
        updated_at = now()
    WHERE id = p_request_id;

    UPDATE equipment
    SET status = v_new_equip_status,
        condition = p_condition,
        updated_at = now()
    WHERE id = v_req.equipment_id;

    INSERT INTO audit_logs (user_id, action, module, record_id, description)
    VALUES (
        auth.uid(),
        'RETURNED',
        'Borrowing',
        p_request_id::TEXT,
        format('Returned %s in %s condition. Remarks: %s', v_req.asset_code, p_condition, COALESCE(p_remarks, 'None'))
    );

    RETURN jsonb_build_object('success', true, 'message', 'Return processed successfully.');
END;
$$;

-- ---------------------------------------------------------------------
-- RPC: Log Audit Event (BR-A4-10)
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION rpc_log_audit(
    p_action TEXT,
    p_module TEXT,
    p_record_id TEXT,
    p_description TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    INSERT INTO audit_logs (user_id, action, module, record_id, description, created_at)
    VALUES (auth.uid(), p_action, p_module, p_record_id, p_description, now());
END;
$$;

-- ---------------------------------------------------------------------
-- Automatic Profile Synchronization on Supabase Auth Signup
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, full_name, email, role, status)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'role', 'requester'),
        'active'
    )
    ON CONFLICT (id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        role = EXCLUDED.role;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
