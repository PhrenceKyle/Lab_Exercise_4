/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * Dashboard Coordinator: Role-Tailored Views, Live Sync & Requester Catalog
 * =====================================================================
 */

import { fetchEquipment } from "./equipment.js";
import { fetchBorrowingRequests, submitBorrowingRequest, cancelBorrowingRequest, subscribeRequesterBorrowingUpdates } from "./borrowing.js";
import { fetchMaintenanceRecords } from "./maintenance.js";
import { session } from "./session.js";
import { supabase, supabaseConfig, localDb } from "./supabase.js";
import { showToast, showModal, showConfirm, renderBorrowingStatusBadge, renderEquipmentStatusBadge } from "./ui.js";

let _dashboardRefreshInterval = null;
let _dashboardStorageListener = false;
let _cachedEquipment = [];
let _cachedBorrowings = [];

export async function initDashboard() {
    const role = session.getRole();
    const profile = session.getProfile();

    const adminStaffView = document.getElementById("admin-staff-dashboard-view");
    const requesterView = document.getElementById("requester-dashboard-view");
    const mainTitle = document.getElementById("dash-main-title");
    const mainSubtitle = document.getElementById("dash-main-subtitle");

    if (role === "requester") {
        if (adminStaffView) adminStaffView.style.display = "none";
        if (requesterView) requesterView.style.display = "block";
        if (mainTitle) mainTitle.textContent = "Requester Portal & Available Assets";
        if (mainSubtitle) mainSubtitle.textContent = "Browse certified laboratory equipment, submit borrowing requests, and track your approval status.";

        setupRequesterFilters();
    } else {
        if (adminStaffView) adminStaffView.style.display = "block";
        if (requesterView) requesterView.style.display = "none";
        if (mainTitle) mainTitle.textContent = role === "administrator" ? "Administrator Command Center" : "Laboratory Staff Operations";
        if (mainSubtitle) mainSubtitle.textContent = "Real-time laboratory asset utilization, pending transactions, approvals, and operational health.";

        const viewAllBorrowingLink = document.getElementById("link-view-all-borrowing");
        if (viewAllBorrowingLink && role === "staff") {
            viewAllBorrowingLink.href = "./pages/staff/borrowing.html";
        }
    }

    // Initial data load
    await refreshDashboardData();

    // Setup Supabase Realtime Listener if available
    setupRealtimeSubscription();

    if (role === "requester" && supabaseConfig.isConfigured() && supabase) {
        subscribeRequesterBorrowingUpdates(async () => {
            await refreshDashboardData(true);
        });
    }

    // Keep this dashboard in sync with shared localStorage updates from Admin/Staff actions
    if (!_dashboardStorageListener) {
        const syncRefresh = async (event) => {
            const changedKeys = ["lab_db_equipment", "lab_db_borrowing", "lab_db_profiles", "lab_db_maintenance", "lab_db_audit", "lab_active_session"];
            const key = event?.detail?.key || event?.key;
            if (key && changedKeys.includes(key)) {
                await refreshDashboardData(true);
            }
        };

        window.addEventListener("lab-data-sync", syncRefresh);
        window.addEventListener("storage", syncRefresh);
        _dashboardStorageListener = true;
    }

    // Setup periodic 8-second background polling for seamless multi-user live updates
    if (!_dashboardRefreshInterval) {
        _dashboardRefreshInterval = setInterval(async () => {
            // Only refresh if tab is currently visible to user
            if (!document.hidden) {
                await refreshDashboardData(true);
            }
        }, 8000);
    }
}

/**
 * Fetch latest data and update corresponding dashboard
 */
async function refreshDashboardData(isBackground = false) {
    const role = session.getRole();
    const profile = session.getProfile();

    try {
        const [equipRes, borrowRes, maintRes] = await Promise.allSettled([
            fetchEquipment(),
            fetchBorrowingRequests(),
            fetchMaintenanceRecords()
        ]);

        const equipment = equipRes.status === "fulfilled" ? equipRes.value : (localDb.get("equipment") || []);
        const borrowings = borrowRes.status === "fulfilled" ? borrowRes.value : (localDb.get("borrowing") || []);
        const maintenance = maintRes.status === "fulfilled" ? maintRes.value : (localDb.get("maintenance") || []);

        _cachedEquipment = equipment;
        _cachedBorrowings = borrowings;

        if (role === "administrator") {
            let users = [];
            try {
                const { fetchUsers } = await import("./users.js");
                users = await fetchUsers();
            } catch (e) {
                users = localDb.get("profiles") || [];
            }
            renderAdminDashboard(equipment, borrowings, maintenance, users);
        } else if (role === "staff") {
            renderStaffDashboard(equipment, borrowings, maintenance);
        } else {
            renderRequesterDashboard(equipment, borrowings, profile);
        }
    } catch (err) {
        if (!isBackground) {
            console.error("Dashboard refresh error:", err);
        }
    }
}

/**
 * Setup Supabase Realtime Subscription for equipment & borrowing tables
 */
function setupRealtimeSubscription() {
    if (supabaseConfig.isConfigured() && supabase && supabase.channel) {
        try {
            supabase
                .channel("public-lab-sync")
                .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, () => {
                    refreshDashboardData(true);
                })
                .on("postgres_changes", { event: "*", schema: "public", table: "borrowing_requests" }, () => {
                    refreshDashboardData(true);
                })
                .subscribe();
        } catch (e) {
            console.warn("Realtime subscription deferred, relying on polling:", e.message);
        }
    }
}

/**
 * Administrator Dashboard View
 */
function renderAdminDashboard(equipment, borrowings, maintenance, users = []) {
    const totalUsers = (users && users.length) ? users.length : (localDb.get("profiles") || []).length;
    const totalEquip = equipment.length;
    const available = equipment.filter(e => e.status === "Available").length;
    const borrowed = equipment.filter(e => e.status === "Borrowed").length;
    const inMaint = equipment.filter(e => e.status === "Maintenance").length;
    const pending = borrowings.filter(b => b.status === "Pending").length;
    const approved = borrowings.filter(b => b.status === "Approved").length;
    const overdue = borrowings.filter(b => b.status === "Overdue").length;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setVal("kpi-total-users", totalUsers);
    setVal("kpi-total-equipment", totalEquip);
    setVal("kpi-available-equipment", available);
    setVal("kpi-borrowed-equipment", borrowed);
    setVal("kpi-maintenance-equipment", inMaint);
    setVal("kpi-pending-requests", pending);
    setVal("kpi-approved-requests", approved);
    setVal("kpi-overdue-transactions", overdue);

    // Recent Requests Table (Top 5)
    const recentTable = document.getElementById("dash-recent-requests-body");
    if (recentTable) {
        const recent = borrowings.slice(0, 5);
        if (recent.length === 0) {
            recentTable.innerHTML = `<tr><td colspan="5" class="empty-state">No recent requests</td></tr>`;
        } else {
            recentTable.innerHTML = recent.map(r => `
                <tr>
                    <td><strong>${r.equipment ? escapeHtml(r.equipment.asset_code) : 'N/A'}</strong></td>
                    <td>${r.requester ? escapeHtml(r.requester.full_name) : 'User'}</td>
                    <td>${r.request_date}</td>
                    <td>${r.expected_return_date}</td>
                    <td>${renderBorrowingStatusBadge(r.status)}</td>
                </tr>
            `).join("");
        }
    }

    // Recent Audit Stream (Top 6)
    const auditStream = document.getElementById("dash-audit-stream-body");
    if (auditStream) {
        const logs = localDb.get("audit").slice(0, 6);
        auditStream.innerHTML = logs.map(l => `
            <div style="display: flex; align-items: flex-start; gap: 0.75rem; padding: 0.65rem 0; border-bottom: 1px solid var(--border-color); font-size: 0.825rem;">
                <div style="font-size: 1.1rem;">📝</div>
                <div style="flex: 1;">
                    <div style="display: flex; justify-content: space-between; margin-bottom: 0.15rem;">
                        <strong>${escapeHtml(l.action)}</strong>
                        <span style="color: var(--text-light); font-size: 0.75rem;">${new Date(l.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <div style="color: var(--text-muted);">${escapeHtml(l.description)}</div>
                </div>
            </div>
        `).join("");
    }
}

/**
 * Staff Dashboard View
 */
function renderStaffDashboard(equipment, borrowings, maintenance) {
    const available = equipment.filter(e => e.status === "Available").length;
    const borrowed = equipment.filter(e => e.status === "Borrowed").length;
    const pending = borrowings.filter(b => b.status === "Pending").length;
    const overdue = borrowings.filter(b => b.status === "Overdue").length;
    const maintCount = maintenance.filter(m => m.status === "Pending" || m.status === "In Progress").length;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setVal("kpi-total-equipment", equipment.length);
    setVal("kpi-available-equipment", available);
    setVal("kpi-borrowed-equipment", borrowed);
    setVal("kpi-pending-requests", pending);
    setVal("kpi-overdue-transactions", overdue);
    setVal("kpi-maintenance-equipment", maintCount);

    const recentTable = document.getElementById("dash-recent-requests-body");
    if (recentTable) {
        const active = borrowings.filter(b => b.status === "Approved" || b.status === "Released" || b.status === "Overdue").slice(0, 5);
        if (active.length === 0) {
            recentTable.innerHTML = `<tr><td colspan="5" class="empty-state">No operational transactions pending</td></tr>`;
        } else {
            recentTable.innerHTML = active.map(r => `
                <tr>
                    <td><strong>${r.equipment ? escapeHtml(r.equipment.asset_code) : 'N/A'}</strong></td>
                    <td>${r.requester ? escapeHtml(r.requester.full_name) : 'User'}</td>
                    <td>${r.request_date}</td>
                    <td>${r.expected_return_date}</td>
                    <td>${renderBorrowingStatusBadge(r.status)}</td>
                </tr>
            `).join("");
        }
    }
}

/**
 * Requester Dashboard View: Live Available Equipment Catalog + My Requests
 */
function renderRequesterDashboard(equipment, borrowings, profile) {
    const available = equipment.filter(e => e.status && e.status.toLowerCase() === "available").length;
    const myPending = borrowings.filter(b => b.requester_id === profile.id && b.status === "Pending").length;
    const myActive = borrowings.filter(b => b.requester_id === profile.id && ["Approved", "Released", "Overdue"].includes(b.status)).length;
    const myHistory = borrowings.filter(b => b.requester_id === profile.id && (b.status === "Returned" || b.status === "Closed")).length;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setVal("kpi-req-available", available);
    setVal("kpi-req-pending", myPending);
    setVal("kpi-req-active", myActive);
    setVal("kpi-req-history", myHistory);

    // 1. Render Available Equipment Catalog Table
    renderRequesterEquipmentTable(equipment);

    // 2. Render My Active Requests Table
    renderRequesterMyRequestsTable(borrowings, profile);

    // 3. Render Borrowed Equipment section that reflects approved requests immediately from Supabase
    renderRequesterBorrowedEquipmentTable(borrowings, profile);
}

/**
 * Render Available Equipment Table on Requester Dashboard
 */
function renderRequesterEquipmentTable(equipment) {
    const tableBody = document.getElementById("dash-req-equipment-body");
    if (!tableBody) return;

    const searchInput = document.getElementById("dash-req-search");
    const categorySelect = document.getElementById("dash-req-category");
    const statusSelect = document.getElementById("dash-req-status");

    const query = (searchInput ? searchInput.value : "").toLowerCase().trim();
    const cat = categorySelect ? categorySelect.value : "";
    const stat = statusSelect ? statusSelect.value : "";

    const filtered = equipment.filter(e => {
        const matchQuery = !query ||
            (e.asset_code && e.asset_code.toLowerCase().includes(query)) ||
            (e.equipment_name && e.equipment_name.toLowerCase().includes(query)) ||
            (e.description && e.description.toLowerCase().includes(query)) ||
            (e.location && e.location.toLowerCase().includes(query));

        const matchCat = !cat || e.category === cat;
        const matchStat = !stat || (e.status && e.status.toLowerCase() === stat.toLowerCase());
        return matchQuery && matchCat && matchStat;
    });

    if (filtered.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="8" class="empty-state">
                    <div class="empty-icon">🔬</div>
                    <div class="empty-title">No Equipment Found</div>
                    <p class="empty-text">No equipment matches your search or filter. When Admin or Staff registers equipment, it appears here automatically.</p>
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = filtered.map(item => {
        const isAvail = item.status && item.status.toLowerCase() === "available";
        let actionBtn = "";

        if (isAvail) {
            actionBtn = `
                <button type="button" class="btn btn-sm btn-primary btn-dash-req-action" 
                    data-id="${item.id}" 
                    data-code="${escapeHtml(item.asset_code)}" 
                    data-name="${escapeHtml(item.equipment_name)}"
                    data-location="${escapeHtml(item.location)}"
                    data-category="${escapeHtml(item.category)}">
                    ⚡ Request
                </button>
            `;
        } else {
            actionBtn = `<span class="badge badge-${(item.status || 'neutral').toLowerCase()}" style="font-size: 0.75rem;">Unavailable</span>`;
        }

        return `
            <tr>
                <td><strong><code>${escapeHtml(item.asset_code)}</code></strong></td>
                <td>
                    <div style="font-weight: 600; color: var(--primary-900); font-size: 0.9rem;">${escapeHtml(item.equipment_name)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(item.description || 'Certified laboratory hardware asset')}</div>
                </td>
                <td><span class="badge badge-neutral" style="font-size: 0.75rem;">${escapeHtml(item.category)}</span></td>
                <td>${escapeHtml(item.location)}</td>
                <td>${escapeHtml(item.condition || 'Good')}</td>
                <td>
                    <span class="badge" style="background: var(--primary-50); color: var(--primary-800); font-weight: 600;">
                        ${item.quantity || 1} unit(s)
                    </span>
                </td>
                <td>${renderEquipmentStatusBadge(item.status)}</td>
                <td class="actions-col">${actionBtn}</td>
            </tr>
        `;
    }).join("");

    // Bind Instant Request Buttons
    tableBody.querySelectorAll(".btn-dash-req-action").forEach(btn => {
        btn.addEventListener("click", () => {
            const equipId = btn.dataset.id;
            const code = btn.dataset.code;
            const name = btn.dataset.name;
            const location = btn.dataset.location;
            const category = btn.dataset.category;

            openInstantRequestModal({
                id: equipId,
                asset_code: code,
                equipment_name: name,
                location,
                category
            });
        });
    });
}

/**
 * Instant Borrowing Request Modal from Dashboard
 */
function openInstantRequestModal(equip) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const minDate = new Date().toISOString().split("T")[0];
    const defaultDate = tomorrow.toISOString().split("T")[0];

    showModal({
        title: `Request Equipment: ${equip.asset_code}`,
        bodyHtml: `
            <div style="padding: 0.75rem; background: var(--bg-card); border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 1.25rem;">
                <div style="font-weight: 700; color: var(--primary-900); font-size: 1rem;">${escapeHtml(equip.equipment_name)}</div>
                <div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.25rem;">
                    Category: <strong>${escapeHtml(equip.category)}</strong> &bull; Location: <strong>${escapeHtml(equip.location)}</strong>
                </div>
            </div>

            <form id="form-dash-request" novalidate>
                <div class="form-group">
                    <label class="form-label required">Purpose of Borrowing</label>
                    <textarea id="modal-req-purpose" class="form-textarea" placeholder="e.g. Laboratory Experiment 4: Digital Logic & Hardware Implementation" rows="3" required></textarea>
                </div>

                <div class="form-group">
                    <label class="form-label required">Expected Return Date</label>
                    <input type="date" id="modal-req-return-date" class="form-control" min="${minDate}" value="${defaultDate}" required>
                </div>
            </form>
        `,
        confirmText: "Submit Borrowing Request",
        confirmClass: "btn-primary",
        onConfirm: async () => {
            const purpose = document.getElementById("modal-req-purpose").value.trim();
            const returnDate = document.getElementById("modal-req-return-date").value;

            if (!purpose) {
                showToast("Required", "Please describe the purpose of borrowing.", "warning");
                return false;
            }

            if (!returnDate) {
                showToast("Required", "Please select an expected return date.", "warning");
                return false;
            }

            try {
                await submitBorrowingRequest({
                    equipmentId: equip.id,
                    purpose,
                    expectedReturnDate: returnDate
                });

                showToast("Request Submitted", `Borrowing request for ${equip.asset_code} submitted with status 'Pending'.`, "success");
                await refreshDashboardData();
                return true;
            } catch (err) {
                showToast("Error", err.message, "error");
                return false;
            }
        }
    });
}

/**
 * Render My Active Requests on Requester Dashboard
 */
function renderRequesterMyRequestsTable(borrowings, profile) {
    const tableBody = document.getElementById("dash-req-my-requests-body");
    if (!tableBody) return;

    const myRequests = borrowings.filter(b => b.requester_id === profile.id);
    const active = myRequests.filter(b => b.status !== "Returned" && b.status !== "Closed" && b.status !== "Rejected");

    if (active.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" class="empty-state">
                    <div class="empty-icon">📋</div>
                    <div class="empty-title">No Active Requests</div>
                    <p class="empty-text">You have no active or pending requests. Select an available equipment above and click 'Request'.</p>
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = active.map(req => {
        const equip = req.equipment || { asset_code: "N/A", equipment_name: "Asset" };
        let actionBtn = `<span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(req.status)}</span>`;

        if (req.status === "Pending") {
            actionBtn = `<button class="btn btn-sm btn-danger btn-dash-cancel-req" data-id="${req.id}" title="Cancel this pending request">Cancel</button>`;
        }

        return `
            <tr>
                <td><code>${String(req.id).slice(0, 8)}...</code></td>
                <td>
                    <strong>${escapeHtml(equip.asset_code)}</strong>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(equip.equipment_name)}</div>
                </td>
                <td style="max-width: 250px;">${escapeHtml(req.purpose)}</td>
                <td>${req.request_date}</td>
                <td><strong>${req.expected_return_date}</strong></td>
                <td>${renderBorrowingStatusBadge(req.status)}</td>
                <td class="actions-col">${actionBtn}</td>
            </tr>
        `;
    }).join("");

    // Bind Cancel buttons
    tableBody.querySelectorAll(".btn-dash-cancel-req").forEach(btn => {
        btn.addEventListener("click", () => {
            const id = btn.dataset.id;
            showConfirm(
                "Cancel Borrowing Request",
                "Are you sure you want to cancel this pending request?",
                async () => {
                    try {
                        await cancelBorrowingRequest(id);
                        showToast("Cancelled", "Borrowing request cancelled.", "info");
                        await refreshDashboardData();
                    } catch (err) {
                        showToast("Error", err.message, "error");
                    }
                },
                "Cancel Request",
                "btn-danger"
            );
        });
    });
}

/**
 * Render Borrowed Equipment for Requesters using the current approved/released state from Supabase.
 */
function renderRequesterBorrowedEquipmentTable(borrowings, profile) {
    const tableBody = document.getElementById("dash-req-borrowed-body");
    if (!tableBody) return;

    const borrowed = borrowings.filter(b => b.requester_id === profile.id && ["Approved", "Released", "Overdue"].includes(b.status));

    if (borrowed.length === 0) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="empty-state">
                    <div class="empty-icon">📦</div>
                    <div class="empty-title">No Borrowed Equipment</div>
                    <p class="empty-text">Approved equipment will appear here as soon as the administrator updates the request.</p>
                </td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = borrowed.map(req => {
        const equip = req.equipment || { asset_code: "N/A", equipment_name: "Asset" };
        const approvedOn = req.approved_at ? new Date(req.approved_at).toLocaleDateString() : (req.request_date || "N/A");
        const actionText = req.status === "Approved"
            ? "Awaiting Release"
            : (req.status === "Released" ? "Return Window Open" : "Overdue");

        return `
            <tr>
                <td><strong><code>${escapeHtml(equip.asset_code)}</code></strong></td>
                <td>
                    <div style="font-weight: 600; color: var(--primary-900); font-size: 0.9rem;">${escapeHtml(equip.equipment_name)}</div>
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(req.purpose || 'Borrowed equipment')}</div>
                </td>
                <td>${renderBorrowingStatusBadge(req.status)}</td>
                <td>${approvedOn}</td>
                <td><strong>${req.expected_return_date || 'N/A'}</strong></td>
                <td class="actions-col"><span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(actionText)}</span></td>
            </tr>
        `;
    }).join("");
}

/**
 * Bind Search & Category filters on Requester Dashboard
 */
function setupRequesterFilters() {
    const searchInput = document.getElementById("dash-req-search");
    const categorySelect = document.getElementById("dash-req-category");
    const statusSelect = document.getElementById("dash-req-status");

    if (searchInput) {
        searchInput.addEventListener("input", () => {
            renderRequesterEquipmentTable(_cachedEquipment);
        });
    }

    if (categorySelect) {
        categorySelect.addEventListener("change", () => {
            renderRequesterEquipmentTable(_cachedEquipment);
        });
    }

    if (statusSelect) {
        statusSelect.addEventListener("change", () => {
            renderRequesterEquipmentTable(_cachedEquipment);
        });
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}
