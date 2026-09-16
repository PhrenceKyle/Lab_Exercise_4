-- =====================================================================
-- LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
-- Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
-- Row Level Security (RLS) Policies
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. ENABLE ROW LEVEL SECURITY ON ALL TABLES
-- ---------------------------------------------------------------------
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE equipment ENABLE ROW LEVEL SECURITY;
ALTER TABLE borrowing_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE maintenance ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------
-- 2. HELPER FUNCTIONS FOR RLS EVALUATION
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND role = 'administrator' AND status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION is_staff()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND role = 'staff' AND status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION is_staff_or_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
    SELECT EXISTS (
        SELECT 1 FROM profiles
        WHERE id = auth.uid() AND role IN ('administrator', 'staff') AND status = 'active'
    );
$$;

-- ---------------------------------------------------------------------
-- 3. PROFILES POLICIES
-- ---------------------------------------------------------------------
-- Anyone authenticated can read profiles (needed for displaying user names, requesters, etc.)
CREATE POLICY "Allow authenticated users to read profiles"
ON profiles FOR SELECT
TO authenticated
USING (true);

-- Users can insert their own profile on signup / registration
CREATE POLICY "Allow users to insert their own profile"
ON profiles FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- Administrator can insert, update, or delete any profile
CREATE POLICY "Allow admin full access to profiles"
ON profiles FOR ALL
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- Users can update their own profile basic info (except role and status)
CREATE POLICY "Allow users to update own profile"
ON profiles FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (
    auth.uid() = id AND
    role = (SELECT role FROM profiles WHERE id = auth.uid()) AND
    status = (SELECT status FROM profiles WHERE id = auth.uid())
);

-- ---------------------------------------------------------------------
-- 4. EQUIPMENT POLICIES
-- ---------------------------------------------------------------------
-- All authenticated users can view equipment (Requesters, Staff, Admin)
CREATE POLICY "Allow authenticated users to view equipment"
ON equipment FOR SELECT
TO authenticated
USING (true);

-- Only Administrator can insert new equipment
CREATE POLICY "Allow admin to insert equipment"
ON equipment FOR INSERT
TO authenticated
WITH CHECK (is_admin());

-- Administrator and Staff can update equipment (e.g. status changes during operations)
CREATE POLICY "Allow admin and staff to update equipment"
ON equipment FOR UPDATE
TO authenticated
USING (is_staff_or_admin())
WITH CHECK (is_staff_or_admin());

-- Only Administrator can delete equipment (Restricted Delete)
-- Staff and Requester CANNOT delete (TC-A4-09)
CREATE POLICY "Allow only admin to delete equipment"
ON equipment FOR DELETE
TO authenticated
USING (is_admin());

-- ---------------------------------------------------------------------
-- 5. BORROWING REQUESTS POLICIES
-- ---------------------------------------------------------------------
-- Administrator and Staff can view all borrowing requests
CREATE POLICY "Allow admin and staff to view all borrowing requests"
ON borrowing_requests FOR SELECT
TO authenticated
USING (is_staff_or_admin());

-- Requester can ONLY view their own borrowing requests
CREATE POLICY "Allow requester to view own borrowing requests"
ON borrowing_requests FOR SELECT
TO authenticated
USING (auth.uid() = requester_id);

-- Any active user can submit a request for themselves with status = 'Pending'
CREATE POLICY "Allow users to insert own borrowing request"
ON borrowing_requests FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = requester_id AND
    status = 'Pending'
);

-- Administrator can update any borrowing request (Approve, Reject, etc.)
CREATE POLICY "Allow admin to update borrowing requests"
ON borrowing_requests FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

-- Staff can update borrowing requests ONLY for Release and Return operations
-- Staff CANNOT approve or reject (enforced by trigger & RLS)
CREATE POLICY "Allow staff to update approved or released requests"
ON borrowing_requests FOR UPDATE
TO authenticated
USING (
    is_staff() AND status IN ('Approved', 'Released', 'Overdue')
)
WITH CHECK (
    is_staff() AND status IN ('Released', 'Returned', 'Overdue')
);

-- Only Administrator can delete borrowing requests
CREATE POLICY "Allow only admin to delete borrowing requests"
ON borrowing_requests FOR DELETE
TO authenticated
USING (is_admin());

-- ---------------------------------------------------------------------
-- 6. MAINTENANCE POLICIES
-- ---------------------------------------------------------------------
-- Administrator and Staff can view maintenance records
CREATE POLICY "Allow admin and staff to view maintenance"
ON maintenance FOR SELECT
TO authenticated
USING (is_staff_or_admin());

-- Administrator and Staff can submit maintenance requests
CREATE POLICY "Allow admin and staff to insert maintenance"
ON maintenance FOR INSERT
TO authenticated
WITH CHECK (
    is_staff_or_admin() AND
    auth.uid() = requested_by
);

-- Administrator can update all maintenance records; Staff can update if assigned
CREATE POLICY "Allow admin to update maintenance"
ON maintenance FOR UPDATE
TO authenticated
USING (is_admin())
WITH CHECK (is_admin());

CREATE POLICY "Allow staff to update assigned maintenance"
ON maintenance FOR UPDATE
TO authenticated
USING (is_staff() AND assigned_to = auth.uid())
WITH CHECK (is_staff() AND assigned_to = auth.uid());

-- Only Administrator can delete maintenance records
CREATE POLICY "Allow only admin to delete maintenance"
ON maintenance FOR DELETE
TO authenticated
USING (is_admin());

-- ---------------------------------------------------------------------
-- 7. AUDIT LOGS POLICIES (Immutable & Role-Restricted)
-- ---------------------------------------------------------------------
-- ONLY Administrator can view audit logs (TC-A4-01, TC-A4-09)
-- Laboratory Staff and Requesters are strictly denied SELECT access!
CREATE POLICY "Allow only admin to view audit logs"
ON audit_logs FOR SELECT
TO authenticated
USING (is_admin());

-- Authenticated users can insert their own audit entries (or via SECURITY DEFINER functions)
CREATE POLICY "Allow users to insert their own audit logs"
ON audit_logs FOR INSERT
TO authenticated
WITH CHECK (
    auth.uid() = user_id OR user_id IS NULL
);

-- NO ONE can update audit logs (Immutable)
-- No UPDATE policy created = updates blocked by default.

-- NO ONE can delete audit logs (Immutable)
-- No DELETE policy created = deletes blocked by default.
