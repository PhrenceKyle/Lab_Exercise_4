-- =====================================================================
-- LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
-- Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
-- Demo Seed Data (PostgreSQL / Supabase)
-- =====================================================================

-- Defined Demo User IDs for consistent relational testing
-- Admin:     a0000000-0000-0000-0000-000000000001
-- Staff:     b0000000-0000-0000-0000-000000000002
-- Requester: c0000000-0000-0000-0000-000000000003
-- Requester 2: c0000000-0000-0000-0000-000000000004

-- ---------------------------------------------------------------------
-- 1. SEED AUTH USERS & PROFILES
-- Note: In Supabase, you can either sign up through the web interface or
-- execute this snippet to populate both auth.users and public.profiles.
-- Default passwords: admin123, staff123, requester123
-- ---------------------------------------------------------------------

DO $$
BEGIN
    -- Insert demo users into auth.users if not already existing
    -- Password hashes are generated for each account using standard blowfish/bcrypt.
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'auth' AND table_name = 'users') THEN
        INSERT INTO auth.users (
            id, instance_id, aud, role, email, encrypted_password,
            email_confirmed_at, recovery_sent_at, last_sign_in_at,
            raw_app_meta_data, raw_user_meta_data, created_at, updated_at
        )
        VALUES
        ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@gmail.com', crypt('admin123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Maria Santos"}', now(), now()),
        ('b0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'staff@gmail.com', crypt('staff123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Carlos Reyes"}', now(), now()),
        ('c0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'requester@gmail.com', crypt('requester123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Juan Dela Cruz"}', now(), now()),
        ('c0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ana@lab.edu', crypt('Password@123', gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{"full_name":"Ana Lim"}', now(), now())
        ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            encrypted_password = EXCLUDED.encrypted_password,
            raw_user_meta_data = EXCLUDED.raw_user_meta_data,
            email_confirmed_at = EXCLUDED.email_confirmed_at,
            updated_at = EXCLUDED.updated_at;
    END IF;
END $$;

-- Populate profiles
INSERT INTO profiles (id, full_name, email, role, status, created_at)
VALUES
('a0000000-0000-0000-0000-000000000001', 'Maria Santos', 'admin@gmail.com', 'administrator', 'active', now() - INTERVAL '30 days'),
('b0000000-0000-0000-0000-000000000002', 'Carlos Reyes', 'staff@gmail.com', 'staff', 'active', now() - INTERVAL '25 days'),
('c0000000-0000-0000-0000-000000000003', 'Juan Dela Cruz', 'requester@gmail.com', 'requester', 'active', now() - INTERVAL '20 days'),
('c0000000-0000-0000-0000-000000000004', 'Ana Lim', 'ana@lab.edu', 'requester', 'active', now() - INTERVAL '15 days')
ON CONFLICT (id) DO UPDATE SET
    full_name = EXCLUDED.full_name,
    email = EXCLUDED.email,
    role = EXCLUDED.role,
    status = EXCLUDED.status;

-- ---------------------------------------------------------------------
-- 2. SEED EQUIPMENT
-- ---------------------------------------------------------------------
INSERT INTO equipment (id, asset_code, equipment_name, category, description, location, condition, status, serial_number, acquisition_date)
VALUES
('e0000000-0000-0000-0000-000000000001', 'LAP-001', 'Dell Latitude 5420 i7 16GB', 'Laptops', 'High-performance laptop for data analysis and programming labs', 'Lab Room 301 - Cabinet A', 'Good', 'Available', 'DL-5420-98432', '2025-01-15'),
('e0000000-0000-0000-0000-000000000002', 'LAP-002', 'Lenovo ThinkPad L14 Gen 3', 'Laptops', 'Laboratory workstation laptop for digital circuit modeling', 'Lab Room 301 - Cabinet A', 'Good', 'Available', 'TP-L14-44109', '2025-02-10'),
('e0000000-0000-0000-0000-000000000003', 'PRJ-001', 'Epson EB-X06 3LCD Projector', 'Projectors', 'High brightness projector for thesis defense and lectures', 'Multimedia Lab 204', 'Good', 'Borrowed', 'EP-X06-12098', '2024-11-20'),
('e0000000-0000-0000-0000-000000000004', 'MON-001', 'Dell UltraSharp 27" 4K Monitor', 'Monitors', 'Color-accurate IPS monitor for computer vision research', 'Hardware Lab 305', 'Fair', 'Maintenance', 'DL-U27-66512', '2024-08-05'),
('e0000000-0000-0000-0000-000000000005', 'CAM-001', 'Sony Alpha A6400 4K Camera', 'Cameras', 'Mirrorless camera with 16-50mm lens for laboratory recording', 'AV Storage Room 102', 'Good', 'Available', 'SN-A64-77123', '2025-03-01'),
('e0000000-0000-0000-0000-000000000006', 'OSC-001', 'Rigol DS1054Z Digital Oscilloscope', 'Electronics', '50MHz 4-channel digital oscilloscope for signal analysis', 'Electronics Lab 105', 'Good', 'Available', 'RG-1054-00214', '2024-05-18'),
('e0000000-0000-0000-0000-000000000007', 'DMM-001', 'Fluke 87V Industrial Multimeter', 'Electronics', 'True-RMS digital multimeter with temperature measurement', 'Electronics Lab 105', 'Good', 'Available', 'FK-87V-90112', '2024-06-12'),
('e0000000-0000-0000-0000-000000000008', 'RPI-001', 'Raspberry Pi 4 Model B Lab Kit', 'IoT / Embedded', '8GB RAM starter kit with sensor pack and power supply', 'IoT Lab 304', 'Good', 'Available', 'RP4-8G-33211', '2025-01-20')
ON CONFLICT (asset_code) DO NOTHING;

-- ---------------------------------------------------------------------
-- 3. SEED BORROWING REQUESTS
-- ---------------------------------------------------------------------
INSERT INTO borrowing_requests (
    id, requester_id, equipment_id, purpose, request_date, expected_return_date,
    approved_by, approved_at, rejected_reason, status, released_at, returned_at, closed_at, created_at
)
VALUES
-- 1. Pending Request (Ready for admin approval)
(
    'b0000000-0001-0000-0000-000000000001',
    'c0000000-0000-0000-0000-000000000003',
    'e0000000-0000-0000-0000-000000000002', -- LAP-002
    'Advanced Machine Learning Laboratory Experiment 4',
    CURRENT_DATE,
    CURRENT_DATE + INTERVAL '3 days',
    NULL, NULL, NULL,
    'Pending',
    NULL, NULL, NULL,
    now() - INTERVAL '2 hours'
),
-- 2. Approved Request (Ready for staff release)
(
    'b0000000-0001-0000-0000-000000000002',
    'c0000000-0000-0000-0000-000000000004',
    'e0000000-0000-0000-0000-000000000001', -- LAP-001
    'Undergraduate Capstone System Defense Presentation',
    CURRENT_DATE - INTERVAL '1 day',
    CURRENT_DATE + INTERVAL '2 days',
    'a0000000-0000-0000-0000-000000000001',
    now() - INTERVAL '1 day',
    NULL,
    'Approved',
    NULL, NULL, NULL,
    now() - INTERVAL '1 day'
),
-- 3. Released / Borrowed Transaction (Active borrowing)
(
    'b0000000-0001-0000-0000-000000000003',
    'c0000000-0000-0000-0000-000000000003',
    'e0000000-0000-0000-0000-000000000003', -- PRJ-001
    'Computer Science Department Faculty Research Colloquium',
    CURRENT_DATE - INTERVAL '2 days',
    CURRENT_DATE + INTERVAL '1 day',
    'a0000000-0000-0000-0000-000000000001',
    now() - INTERVAL '2 days',
    NULL,
    'Released',
    now() - INTERVAL '2 days',
    NULL, NULL,
    now() - INTERVAL '2 days'
),
-- 4. Overdue Transaction (Simulated overdue: expected date is in past)
(
    'b0000000-0001-0000-0000-000000000004',
    'c0000000-0000-0000-0000-000000000004',
    'e0000000-0000-0000-0000-000000000005', -- CAM-001
    'Campus Journalism Workshop & Documentary Film Shoot',
    CURRENT_DATE - INTERVAL '7 days',
    CURRENT_DATE - INTERVAL '2 days', -- Past date!
    'a0000000-0000-0000-0000-000000000001',
    now() - INTERVAL '7 days',
    NULL,
    'Overdue',
    now() - INTERVAL '6 days',
    NULL, NULL,
    now() - INTERVAL '7 days'
),
-- 5. Returned / Closed Transaction (History)
(
    'b0000000-0001-0000-0000-000000000005',
    'c0000000-0000-0000-0000-000000000003',
    'e0000000-0000-0000-0000-000000000006', -- OSC-001
    'Embedded Signal Processing Lab Assignment 2',
    CURRENT_DATE - INTERVAL '14 days',
    CURRENT_DATE - INTERVAL '10 days',
    'a0000000-0000-0000-0000-000000000001',
    now() - INTERVAL '14 days',
    NULL,
    'Returned',
    now() - INTERVAL '13 days',
    now() - INTERVAL '10 days',
    now() - INTERVAL '10 days',
    now() - INTERVAL '14 days'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 4. SEED MAINTENANCE RECORDS
-- ---------------------------------------------------------------------
INSERT INTO maintenance (
    id, equipment_id, requested_by, assigned_to, problem_description,
    maintenance_date, status, remarks, created_at
)
VALUES
(
    'm0000000-0000-0000-0000-000000000001',
    'e0000000-0000-0000-0000-000000000004', -- MON-001
    'b0000000-0000-0000-0000-000000000002', -- Carlos Reyes
    'a0000000-0000-0000-0000-000000000001', -- Maria Santos
    'Backlight flickering intermittently when connected via DisplayPort',
    CURRENT_DATE - INTERVAL '4 days',
    'In Progress',
    'Ordered replacement power board and certified DP 1.4 cable',
    now() - INTERVAL '4 days'
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------
-- 5. SEED AUDIT LOGS
-- ---------------------------------------------------------------------
INSERT INTO audit_logs (id, user_id, action, module, record_id, description, created_at)
VALUES
('d0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'LOGIN', 'Auth', 'a0000000-0000-0000-0000-000000000001', 'Maria Santos logged into the system', now() - INTERVAL '2 days'),
('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003', 'CREATE_BORROWING_REQUEST', 'Borrowing', 'b0000000-0001-0000-0000-000000000001', 'Submitted borrowing request for LAP-002', now() - INTERVAL '2 hours'),
('d0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000001', 'APPROVED', 'Borrowing', 'b0000000-0001-0000-0000-000000000002', 'Approved borrowing request for LAP-001', now() - INTERVAL '1 day'),
('d0000000-0000-0000-0000-000000000004', 'b0000000-0000-0000-0000-000000000002', 'RELEASED', 'Borrowing', 'b0000000-0001-0000-0000-000000000003', 'Released PRJ-001 to requester Juan Dela Cruz', now() - INTERVAL '2 days'),
('d0000000-0000-0000-0000-000000000005', 'b0000000-0000-0000-0000-000000000002', 'RETURNED', 'Borrowing', 'b0000000-0001-0000-0000-000000000005', 'Returned OSC-001 in Good condition', now() - INTERVAL '10 days'),
('d0000000-0000-0000-0000-000000000006', 'b0000000-0000-0000-0000-000000000002', 'MAINTENANCE_ACTION', 'Maintenance', 'm0000000-0000-0000-0000-000000000001', 'Submitted maintenance ticket for MON-001', now() - INTERVAL '4 days')
ON CONFLICT (id) DO NOTHING;
