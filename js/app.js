/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * Master Application Bootstrapper & Lifecycle Dispatcher
 * =====================================================================
 */

import { enforcePageGuard } from "./permissions.js?v=2.6";
import { renderSidebar, initHeaderBar, initMobileMenu } from "./ui.js?v=2.6";

document.addEventListener("DOMContentLoaded", async () => {
    // 1. Enforce RBAC security & authentication page guard (TC-A4-01, TC-A4-10)
    const isAllowed = await enforcePageGuard();
    if (!isAllowed) return;

    const path = window.location.pathname.toLowerCase();

    // 2. Identify current page context
    let activeNavKey = "dashboard";
    let breadcrumbTitle = "Dashboard";

    if (path.includes("/users.html")) {
        activeNavKey = "users";
        breadcrumbTitle = "User Management & Role Permissions";
    } else if (path.includes("/equipment.html")) {
        activeNavKey = "equipment";
        breadcrumbTitle = "Laboratory Equipment Catalog";
    } else if (path.includes("/borrowing.html")) {
        activeNavKey = "borrowing";
        breadcrumbTitle = "Borrowing Requests & Approval Management";
    } else if (path.includes("/returns.html")) {
        activeNavKey = "returns";
        breadcrumbTitle = "Equipment Returns Processing";
    } else if (path.includes("/maintenance.html")) {
        activeNavKey = "maintenance";
        breadcrumbTitle = "Equipment Maintenance & Work Orders";
    } else if (path.includes("/reports.html")) {
        activeNavKey = "reports";
        breadcrumbTitle = "Laboratory Asset Reports & Analytics";
    } else if (path.includes("/audit-logs.html") || path.includes("/audit.html")) {
        activeNavKey = "audit";
        breadcrumbTitle = "System Audit Trail & Security Logs";
    } else if (path.includes("/request.html")) {
        activeNavKey = "request";
        breadcrumbTitle = "Submit Equipment Borrowing Request";
    } else if (path.includes("/my-requests.html")) {
        activeNavKey = "my-requests";
        breadcrumbTitle = "Track My Active Borrowing Requests";
    } else if (path.includes("/history.html")) {
        activeNavKey = "history";
        breadcrumbTitle = "My Completed Borrowing History";
    }

    // 3. Render common UI Shell components (if element exists)
    renderSidebar(activeNavKey);
    initHeaderBar(breadcrumbTitle);
    initMobileMenu();

    // 4. Dispatch to respective page controller
    if (path.endsWith("login.html") || path.endsWith("login")) {
        const { initLoginPage } = await import("./auth.js?v=2.6");
        initLoginPage();
    } else if (path.endsWith("dashboard.html") || path.endsWith("dashboard")) {
        const { initDashboard } = await import("./dashboard.js?v=2.6");
        initDashboard();
    } else if (path.includes("/admin/users.html")) {
        const { initUsersPage } = await import("./users.js?v=2.6");
        initUsersPage();
    } else if (path.includes("/admin/equipment.html")) {
        const { initEquipmentPage } = await import("./equipment.js?v=2.6");
        initEquipmentPage("admin");
    } else if (path.includes("/admin/borrowing.html")) {
        const { initAdminBorrowingPage } = await import("./borrowing.js?v=2.6");
        initAdminBorrowingPage();
    } else if (path.includes("/admin/maintenance.html")) {
        const { initMaintenancePage } = await import("./maintenance.js?v=2.6");
        initMaintenancePage("admin");
    } else if (path.includes("/admin/reports.html")) {
        const { initReportsPage } = await import("./reports.js?v=2.6");
        initReportsPage();
    } else if (path.includes("/admin/audit-logs.html")) {
        const { initAuditLogPage } = await import("./audit.js?v=2.6");
        initAuditLogPage();
    } else if (path.includes("/staff/equipment.html")) {
        const { initEquipmentPage } = await import("./equipment.js?v=2.6");
        initEquipmentPage("staff");
    } else if (path.includes("/staff/borrowing.html")) {
        const { initAdminBorrowingPage } = await import("./borrowing.js?v=2.6");
        initAdminBorrowingPage();
    } else if (path.includes("/staff/returns.html")) {
        const { initReturnsPage } = await import("./borrowing.js?v=2.6");
        initReturnsPage();
    } else if (path.includes("/staff/maintenance.html")) {
        const { initMaintenancePage } = await import("./maintenance.js?v=2.6");
        initMaintenancePage("staff");
    } else if (path.includes("/requester/equipment.html")) {
        const { initEquipmentPage } = await import("./equipment.js?v=2.6");
        initEquipmentPage("requester");
    } else if (path.includes("/requester/request.html")) {
        const { initRequesterSubmission } = await import("./borrowing.js?v=2.6");
        initRequesterSubmission();
    } else if (path.includes("/requester/my-requests.html")) {
        const { initMyRequestsPage } = await import("./borrowing.js?v=2.6");
        initMyRequestsPage();
    } else if (path.includes("/requester/history.html")) {
        const { initMyHistoryPage } = await import("./borrowing.js?v=2.6");
        initMyHistoryPage();
    }
});
