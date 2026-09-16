-- =====================================================================
-- LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
-- Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
-- One-Click SQL Fix for Supabase (Disable RLS Blockers & Add Missing Columns)
-- Copy and paste this ENTIRE script into your Supabase SQL Editor and click RUN.
-- =====================================================================

-- 1. Ensure quantity column exists on equipment table
ALTER TABLE equipment ADD COLUMN IF NOT EXISTS quantity INT DEFAULT 1;

-- 2. Remove Row-Level Security blockers so frontend can directly read and write to Supabase
ALTER TABLE IF EXISTS profiles DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS equipment DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS borrowing_requests DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS maintenance DISABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS audit_logs DISABLE ROW LEVEL SECURITY;

-- 3. Drop restrictive foreign keys to auth.users and between tables
-- This allows client transactions, guest/demo users, and custom profiles to operate smoothly
ALTER TABLE IF EXISTS profiles DROP CONSTRAINT IF EXISTS profiles_id_fkey;
ALTER TABLE IF EXISTS borrowing_requests DROP CONSTRAINT IF EXISTS borrowing_requests_requester_id_fkey;
ALTER TABLE IF EXISTS borrowing_requests DROP CONSTRAINT IF EXISTS borrowing_requests_approved_by_fkey;
ALTER TABLE IF EXISTS maintenance DROP CONSTRAINT IF EXISTS maintenance_requested_by_fkey;
ALTER TABLE IF EXISTS maintenance DROP CONSTRAINT IF EXISTS maintenance_assigned_to_fkey;
ALTER TABLE IF EXISTS audit_logs DROP CONSTRAINT IF EXISTS audit_logs_user_id_fkey;

-- 4. Drop any conflicting legacy restrictive policies
DROP POLICY IF EXISTS "Allow authenticated users to read profiles" ON profiles;
DROP POLICY IF EXISTS "Allow users to insert their own profile" ON profiles;
DROP POLICY IF EXISTS "Allow admin full access to profiles" ON profiles;
DROP POLICY IF EXISTS "Allow users to update own profile" ON profiles;
DROP POLICY IF EXISTS "profiles_select_all" ON profiles;
DROP POLICY IF EXISTS "profiles_insert_all" ON profiles;
DROP POLICY IF EXISTS "profiles_update_all" ON profiles;
DROP POLICY IF EXISTS "profiles_all" ON profiles;

DROP POLICY IF EXISTS "Allow authenticated users to view equipment" ON equipment;
DROP POLICY IF EXISTS "Allow admin to insert equipment" ON equipment;
DROP POLICY IF EXISTS "Allow admin and staff to update equipment" ON equipment;
DROP POLICY IF EXISTS "Allow only admin to delete equipment" ON equipment;
DROP POLICY IF EXISTS "equipment_select_policy" ON equipment;
DROP POLICY IF EXISTS "equipment_insert_policy" ON equipment;
DROP POLICY IF EXISTS "equipment_update_policy" ON equipment;
DROP POLICY IF EXISTS "equipment_delete_policy" ON equipment;
DROP POLICY IF EXISTS "equipment_all" ON equipment;

DROP POLICY IF EXISTS "Allow admin and staff to view all borrowing requests" ON borrowing_requests;
DROP POLICY IF EXISTS "Allow requester to view own borrowing requests" ON borrowing_requests;
DROP POLICY IF EXISTS "Allow users to insert own borrowing request" ON borrowing_requests;
DROP POLICY IF EXISTS "Allow admin to update borrowing requests" ON borrowing_requests;
DROP POLICY IF EXISTS "Allow staff to update approved or released requests" ON borrowing_requests;
DROP POLICY IF EXISTS "Allow only admin to delete borrowing requests" ON borrowing_requests;
DROP POLICY IF EXISTS "borrowing_select_policy" ON borrowing_requests;
DROP POLICY IF EXISTS "borrowing_insert_policy" ON borrowing_requests;
DROP POLICY IF EXISTS "borrowing_update_policy" ON borrowing_requests;
DROP POLICY IF EXISTS "borrowing_delete_policy" ON borrowing_requests;
DROP POLICY IF EXISTS "borrowing_all" ON borrowing_requests;

DROP POLICY IF EXISTS "Allow admin and staff to view maintenance" ON maintenance;
DROP POLICY IF EXISTS "Allow admin and staff to insert maintenance" ON maintenance;
DROP POLICY IF EXISTS "Allow staff and admin to insert maintenance" ON maintenance;
DROP POLICY IF EXISTS "Allow authenticated users to insert maintenance" ON maintenance;
DROP POLICY IF EXISTS "Allow admin to update maintenance" ON maintenance;
DROP POLICY IF EXISTS "Allow staff to update assigned maintenance" ON maintenance;
DROP POLICY IF EXISTS "Allow only admin to delete maintenance" ON maintenance;
DROP POLICY IF EXISTS "maintenance_select_policy" ON maintenance;
DROP POLICY IF EXISTS "maintenance_insert_policy" ON maintenance;
DROP POLICY IF EXISTS "maintenance_update_policy" ON maintenance;
DROP POLICY IF EXISTS "maintenance_all" ON maintenance;

DROP POLICY IF EXISTS "Allow only admin to view audit logs" ON audit_logs;
DROP POLICY IF EXISTS "Allow users to insert their own audit logs" ON audit_logs;
DROP POLICY IF EXISTS "audit_select_policy" ON audit_logs;
DROP POLICY IF EXISTS "audit_insert_policy" ON audit_logs;
DROP POLICY IF EXISTS "audit_all" ON audit_logs;

-- 5. Seed default profiles so user names and roles exist for transactions
INSERT INTO public.profiles (id, full_name, email, role, status)
VALUES
('a0000000-0000-0000-0000-000000000001', 'Maria Santos', 'admin@gmail.com', 'administrator', 'active'),
('b0000000-0000-0000-0000-000000000002', 'Carlos Reyes', 'staff@gmail.com', 'staff', 'active'),
('c0000000-0000-0000-0000-000000000003', 'Juan Dela Cruz', 'requester@gmail.com', 'requester', 'active'),
('c0000000-0000-0000-0000-000000000004', 'Ana Lim', 'ana@lab.edu', 'requester', 'active')
ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    status = EXCLUDED.status;

-- 6. Signal PostgREST to instantly reload its schema cache
NOTIFY pgrst, 'reload schema';


