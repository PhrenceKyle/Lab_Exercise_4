/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * Audit Logging Engine: Immutable Trail, Multi-Filter & Verification
 * =====================================================================
 */

import { supabase, supabaseConfig, localDb } from "./supabase.js?v=2.6";
import { session } from "./session.js?v=2.6";

/**
 * Record an audit log event (BR-A4-10)
 */
export async function recordAuditEvent({ userId = null, action, module, recordId = null, description }) {
    const profile = session.getProfile();
    const activeUserId = userId || (profile ? profile.id : null);
    const activeUserName = profile ? profile.full_name : "System / Anonymous";

    // 1. Live Supabase RPC or Direct Insert
    if (supabaseConfig.isConfigured() && supabase) {
        try {
            const { error } = await supabase.from("audit_logs").insert([
                {
                    user_id: activeUserId,
                    action: action.toUpperCase(),
                    module,
                    record_id: recordId ? String(recordId) : null,
                    description,
                    created_at: new Date().toISOString()
                }
            ]);
            if (error) {
                console.warn("Supabase audit log insert error:", error);
            }
            return;
        } catch (err) {
            console.warn("Audit logging failed on Supabase:", err);
        }
    }

    // 2. Demo Storage Engine
    const logs = localDb.get("audit");
    const newLog = {
        id: "d0000000-0000-0000-0000-" + String(Date.now()).slice(-12).padStart(12, "0"),
        user_id: activeUserId,
        user_name: activeUserName,
        action: action.toUpperCase(),
        module,
        record_id: recordId ? String(recordId) : "N/A",
        description,
        created_at: new Date().toISOString()
    };

    logs.unshift(newLog); // Newest first
    localDb.set("audit", logs);
}

/**
 * Fetch audit logs (Administrator only)
 * TC-A4-01 & TC-A4-09 Enforcement: Rejects non-administrator requests
 */
export async function fetchAuditLogs() {
    const role = session.getRole();
    if (role !== "administrator") {
        await recordAuditEvent({
            action: "ACCESS_DENIED",
            module: "Audit",
            description: `Unauthorized read attempt on audit logs by user with role '${role}'`
        });
        throw new Error("Access Denied: Only Administrator may view system audit logs.");
    }

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            const { data, error } = await supabase
                .from("audit_logs")
                .select("*")
                .order("created_at", { ascending: false });

            if (!error && data) {
                let profList = [];
                try {
                    const { data: allProfiles } = await supabase.from("profiles").select("*");
                    profList = allProfiles || (localDb.get("profiles") || []);
                } catch (pe) {
                    profList = localDb.get("profiles") || [];
                }

                return data.map(log => {
                    const prof = profList.find(p => p.id === log.user_id);
                    return {
                        ...log,
                        user_name: prof ? prof.full_name : (log.user_id ? "User" : "System / User")
                    };
                });
            }
        } catch (err) {
            console.warn("Failed to load audit logs from Supabase, falling back to local store:", err.message);
        }
    }

    // Demo adapter
    return localDb.get("audit");
}

/**
 * Render Audit Log Table with Search, Filter & Pagination
 */
export async function initAuditLogPage() {
    const tableBody = document.getElementById("audit-table-body");
    const searchInput = document.getElementById("audit-search");
    const actionFilter = document.getElementById("audit-action-filter");
    const moduleFilter = document.getElementById("audit-module-filter");
    const totalCountEl = document.getElementById("audit-total-count");

    if (!tableBody) return;

    let allLogs = [];

    try {
        allLogs = await fetchAuditLogs();
    } catch (err) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; color: var(--color-damaged); padding: 2rem;">
                    ${err.message}
                </td>
            </tr>
        `;
        return;
    }

    function renderFiltered() {
        const query = (searchInput ? searchInput.value : "").toLowerCase().trim();
        const action = actionFilter ? actionFilter.value : "";
        const mod = moduleFilter ? moduleFilter.value : "";

        const filtered = allLogs.filter(item => {
            const matchQuery = !query ||
                (item.description && item.description.toLowerCase().includes(query)) ||
                (item.user_name && item.user_name.toLowerCase().includes(query)) ||
                (item.action && item.action.toLowerCase().includes(query)) ||
                (item.record_id && String(item.record_id).toLowerCase().includes(query));

            const matchAction = !action || item.action === action;
            const matchMod = !mod || item.module === mod;

            return matchQuery && matchAction && matchMod;
        });

        if (totalCountEl) {
            totalCountEl.textContent = `Showing ${filtered.length} of ${allLogs.length} audit records`;
        }

        if (filtered.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        <div class="empty-icon">📜</div>
                        <div class="empty-title">No Audit Logs Found</div>
                        <p class="empty-text">No records match the current filter criteria.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = filtered.map(log => {
            const dateStr = new Date(log.created_at).toLocaleString();
            let actionBadgeClass = "badge-closed";
            if (log.action === "APPROVED") actionBadgeClass = "badge-approved";
            else if (log.action === "REJECTED") actionBadgeClass = "badge-rejected";
            else if (log.action === "RELEASED") actionBadgeClass = "badge-released";
            else if (log.action === "RETURNED") actionBadgeClass = "badge-returned";
            else if (log.action === "ACCESS_DENIED") actionBadgeClass = "badge-overdue";
            else if (log.action === "LOGIN" || log.action === "LOGOUT") actionBadgeClass = "badge-borrowed";
            else if (log.action.includes("CREATE")) actionBadgeClass = "badge-available";

            return `
                <tr>
                    <td><code style="color: var(--primary-700);">${log.id ? String(log.id).slice(0, 8) + '...' : 'N/A'}</code></td>
                    <td><strong>${escapeHtml(log.user_name || "System")}</strong></td>
                    <td><span class="badge ${actionBadgeClass}">${escapeHtml(log.action)}</span></td>
                    <td><span style="font-weight: 500;">${escapeHtml(log.module)}</span></td>
                    <td><code>${escapeHtml(log.record_id || 'N/A')}</code></td>
                    <td style="max-width: 320px; line-height: 1.4;">${escapeHtml(log.description)}</td>
                    <td style="color: var(--text-muted); font-size: 0.8rem; white-space: nowrap;">${dateStr}</td>
                </tr>
            `;
        }).join("");
    }

    if (searchInput) searchInput.addEventListener("input", renderFiltered);
    if (actionFilter) actionFilter.addEventListener("change", renderFiltered);
    if (moduleFilter) moduleFilter.addEventListener("change", renderFiltered);

    renderFiltered();
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
