/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * Role-Based Access Control (RBAC), Route Guard & Permission Engine
 * =====================================================================
 */

import { session } from "./session.js?v=2.6";

// Official Role-Permission Matrix
export const ROLE_PERMISSIONS = {
    administrator: {
        dashboard: true,
        view_equipment: true,
        manage_equipment: true,
        manage_users: true,
        submit_borrowing_request: true,
        view_own_requests: true,
        view_all_requests: true,
        approve_request: true,
        reject_request: true,
        release_equipment: true,
        process_return: true,
        submit_maintenance: true,
        manage_maintenance: true,
        reports: true,
        audit_logs: true,
        restricted_delete: true
    },
    staff: {
        dashboard: true,
        view_equipment: true,
        manage_equipment: false,
        manage_users: false,
        submit_borrowing_request: true,
        view_own_requests: true,
        view_all_requests: true,
        approve_request: false,
        reject_request: false,
        release_equipment: true,
        process_return: true,
        submit_maintenance: true,
        manage_maintenance: false,
        reports: "limited",
        audit_logs: false,
        restricted_delete: false
    },
    requester: {
        dashboard: true,
        view_equipment: true,
        manage_equipment: false,
        manage_users: false,
        submit_borrowing_request: true,
        view_own_requests: true,
        view_all_requests: false,
        approve_request: false,
        reject_request: false,
        release_equipment: false,
        process_return: false,
        submit_maintenance: false,
        manage_maintenance: false,
        reports: false,
        audit_logs: false,
        restricted_delete: false
    }
};

/**
 * Check if current user has a specific permission
 */
export function can(permissionName) {
    const role = session.getRole();
    if (!role || !ROLE_PERMISSIONS[role]) return false;
    return !!ROLE_PERMISSIONS[role][permissionName];
}

/**
 * Enforce Route Access Guard based on URL structure and role.
 * TC-A4-01: Viewer/Requester attempts to open Admin page -> Access Denied.
 * TC-A4-10: Logout and open protected page -> Redirect to login.
 */
export async function enforcePageGuard() {
    const path = window.location.pathname.toLowerCase();

    // Determine depth for relative redirects to login.html or dashboard.html
    const isUnderPages = path.includes("/pages/");
    const pathToRoot = isUnderPages ? "../../" : "./";
    const loginPage = `${pathToRoot}login.html?v=2.6`;

    // Allow public pages (login.html, index.html)
    if (path.endsWith("login.html") || path.endsWith("login") || path.endsWith("/index.html") || path === "/" || path.endsWith("/laboratory-asset-system/")) {
        // If already logged in on login.html, redirect to dashboard
        if (session.isAuthenticated() && (path.endsWith("login.html") || path.endsWith("login"))) {
            window.location.replace(`${pathToRoot}dashboard.html`);
        }
        return true;
    }

    // Restore and validate the real Supabase Auth session before any protected page loads.
    const liveSession = await session.restoreFromSupabase();
    if (!liveSession || !session.isAuthenticated()) {
        session.clearSession();
        window.location.replace(loginPage);
        return false;
    }

    const currentRole = session.getRole();

    // Check Admin Pages
    if (path.includes("/pages/admin/")) {
        if (currentRole !== "administrator") {
            handleAccessDenied(`User with role '${currentRole}' attempted to access administrator page: ${window.location.pathname}`);
            return false;
        }
    }

    // Check Staff Pages
    if (path.includes("/pages/staff/")) {
        if (currentRole !== "administrator" && currentRole !== "staff") {
            handleAccessDenied(`User with role '${currentRole}' attempted to access staff operational page: ${window.location.pathname}`);
            return false;
        }
    }

    // Check Requester Pages
    if (path.includes("/pages/requester/")) {
        // All authenticated users can view requester pages
    }

    return true;
}

/**
 * Render Access Denied view and record audit event
 */
function handleAccessDenied(reason) {
    // Import audit dynamically or record directly to prevent circular dependency
    import("./audit.js?v=2.6").then(({ recordAuditEvent }) => {
        recordAuditEvent({
            action: "ACCESS_DENIED",
            module: "Security",
            recordId: null,
            description: reason
        });
    }).catch(console.error);

    // Replace document content with 403 Access Denied template
    document.title = "403 Access Denied | Laboratory Asset System";
    
    // Determine relative path to root dashboard
    const isUnderPages = window.location.pathname.includes("/pages/");
    const pathToRoot = isUnderPages ? "../../" : "./";

    document.body.innerHTML = `
        <div class="access-denied-container">
            <div class="access-denied-icon">🚫</div>
            <h2 class="access-denied-title">403 — Access Denied</h2>
            <p class="access-denied-msg">
                You do not have permission to access this page or perform this action.
                Your current role is <strong>${session.getRole() || 'Unauthenticated'}</strong>.
            </p>
            <div style="background: var(--bg-body); border-radius: var(--radius-sm); padding: 0.75rem; font-size: 0.8rem; color: var(--text-muted); margin-bottom: 1.5rem; text-align: left; font-family: monospace;">
                <strong>Security Policy Violation:</strong><br>
                ${reason}
            </div>
            <div style="display: flex; gap: 0.75rem; justify-content: center; flex-wrap: wrap;">
                <a href="${pathToRoot}dashboard.html" class="btn btn-secondary">
                    Return to Dashboard
                </a>
                <a href="${pathToRoot}login.html" class="btn btn-primary">
                    Sign in as Administrator
                </a>
            </div>
        </div>
    `;
}
