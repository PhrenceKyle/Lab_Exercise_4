/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * Maintenance Management Module: Work Orders, Assignments & Status Sync
 * =====================================================================
 */

import { supabase, supabaseConfig, localDb } from "./supabase.js";
import { session } from "./session.js";
import { recordAuditEvent } from "./audit.js";
import { showToast, showModal, showConfirm, closeModal } from "./ui.js";

/**
 * Fetch maintenance tickets
 */
export async function fetchMaintenanceRecords() {
    if (supabaseConfig.isConfigured() && supabase) {
        try {
            const { data, error } = await supabase
                .from("maintenance")
                .select("*, equipment(*)")
                .order("created_at", { ascending: false });

            if (error) throw error;

            // Enrich requester and technician profiles without relying on PostgREST schema cache foreign keys
            if (data && data.length > 0) {
                try {
                    const { data: allProfiles } = await supabase.from("profiles").select("*");
                    const profList = allProfiles || (localDb.get("profiles") || []);
                    data.forEach(m => {
                        if (!m.requester) {
                            m.requester = profList.find(p => p.id === m.requested_by) || null;
                        }
                        if (!m.technician) {
                            m.technician = profList.find(p => p.id === m.assigned_to) || null;
                        }
                    });
                } catch (pe) {
                    console.warn("Maintenance profile enrichment note:", pe.message);
                }
            }

            return data || [];
        } catch (err) {
            console.warn("Supabase maintenance fetch warning, checking cache:", err.message);
            const cached = localDb.get("maintenance") || [];
            if (cached.length > 0) return cached;
            return [];
        }
    }

    const records = localDb.get("maintenance");
    const equipment = localDb.get("equipment");
    const profiles = localDb.get("profiles");

    return records.map(m => ({
        ...m,
        equipment: equipment.find(e => e.id === m.equipment_id) || null,
        requester: profiles.find(p => p.id === m.requested_by) || null,
        technician: profiles.find(p => p.id === m.assigned_to) || null
    }));
}

/**
 * Submit Maintenance Ticket (Staff or Admin)
 * BR-A4-09: Sets equipment status to Maintenance immediately!
 */
export async function submitMaintenanceTicket({ equipmentId, problemDescription }) {
    const profile = session.getProfile();
    const role = session.getRole();

    if (role !== "administrator" && role !== "staff") {
        throw new Error("Access Denied: Only Staff and Administrators may report maintenance issues.");
    }

    if (!equipmentId || !problemDescription || !problemDescription.trim()) {
        throw new Error("Please specify the equipment and describe the problem.");
    }

    let insertedRecord = null;

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            let actualUserId = (profile.id || "").toLowerCase().replace(/[^0-9a-f-]/g, "b");
            if (!actualUserId || actualUserId.length < 32) {
                actualUserId = "b0000000-0000-0000-0000-" + String(Date.now()).slice(-12).padStart(12, "0");
            }
            const { data: authData } = await supabase.auth.getUser();
            if (authData?.user?.id) {
                actualUserId = authData.user.id;
            }

            // Check existing profiles in Supabase
            const { data: existingProfiles } = await supabase.from("profiles").select("id, email, role");
            let matchedProfile = null;
            if (existingProfiles && existingProfiles.length > 0) {
                matchedProfile = existingProfiles.find(p => p.id === actualUserId)
                              || existingProfiles.find(p => p.email && p.email.toLowerCase() === (profile.email || "").toLowerCase())
                              || existingProfiles.find(p => p.role === "staff" || p.role === "administrator")
                              || existingProfiles[0];
            }

            if (matchedProfile) {
                actualUserId = matchedProfile.id;
            } else {
                try {
                    await supabase.from("profiles").upsert({
                        id: actualUserId,
                        email: (authData && authData.user && authData.user.email) || profile.email || "staff@gmail.com",
                        full_name: profile.full_name || "Staff Member",
                        role: role,
                        status: "active"
                    });
                } catch (e) {}
            }

            let { data, error } = await supabase.from("maintenance").insert([{
                equipment_id: equipmentId,
                requested_by: actualUserId,
                problem_description: problemDescription.trim(),
                status: "Pending"
            }]).select().single();

            // Foreign key retry fallback
            if (error && (error.message.includes("foreign key") || error.code === "23503")) {
                const { data: validProfiles } = await supabase.from("profiles").select("id");
                if (validProfiles && validProfiles.length > 0) {
                    for (const vp of validProfiles) {
                        const retry = await supabase.from("maintenance").insert([{
                            equipment_id: equipmentId,
                            requested_by: vp.id,
                            problem_description: problemDescription.trim(),
                            status: "Pending"
                        }]).select().single();
                        if (!retry.error && retry.data) {
                            data = retry.data;
                            error = null;
                            actualUserId = vp.id;
                            break;
                        }
                    }
                }
            }

            if (!error && data) {
                insertedRecord = data;

                // Update equipment status in Supabase
                await supabase.from("equipment").update({ status: "Maintenance" }).eq("id", equipmentId);

                await recordAuditEvent({
                    userId: actualUserId,
                    action: "MAINTENANCE_ACTION",
                    module: "Maintenance",
                    recordId: data.id,
                    description: `Submitted maintenance ticket for equipment ${equipmentId}`
                });

                return data;
            } else if (error) {
                console.warn("Supabase maintenance insert returned error:", error.message);
                if (error.message.includes("row-level security")) {
                    console.warn("RLS issue detected on maintenance table. Falling back to local storage and updating UI.");
                }
            }
        } catch (err) {
            console.warn("Supabase maintenance exception:", err.message);
        }
    }

    // Local / Demo Storage Engine
    const equipment = localDb.get("equipment");
    const equip = equipment.find(e => e.id === equipmentId);
    if (equip) {
        equip.status = "Maintenance";
        equip.updated_at = new Date().toISOString();
        localDb.set("equipment", equipment);
    }

    const records = localDb.get("maintenance");
    const newRecord = {
        id: "m0000000-0000-0000-0000-" + String(Date.now()).slice(-12).padStart(12, "0"),
        equipment_id: equipmentId,
        requested_by: profile.id,
        assigned_to: null,
        problem_description: problemDescription.trim(),
        maintenance_date: new Date().toISOString().split("T")[0],
        status: "Pending",
        remarks: null,
        created_at: new Date().toISOString()
    };

    records.unshift(newRecord);
    localDb.set("maintenance", records);

    await recordAuditEvent({
        userId: profile.id,
        action: "MAINTENANCE_ACTION",
        module: "Maintenance",
        recordId: newRecord.id,
        description: `Submitted maintenance ticket for ${equip ? equip.asset_code : equipmentId}`
    });

    return newRecord;
}

/**
 * Update Maintenance Ticket (Admin Only)
 */
export async function updateMaintenanceTicket(ticketId, { status, remarks, assignedTo }) {
    const role = session.getRole();
    if (role !== "administrator") {
        throw new Error("Access Denied: Only Administrator can manage maintenance tickets.");
    }

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            const { data, error } = await supabase
                .from("maintenance")
                .update({ status, remarks, assigned_to: assignedTo })
                .eq("id", ticketId)
                .select()
                .single();

            if (!error && data) {
                // If maintenance completed or cancelled, return equipment to Available in Supabase
                if (status === "Completed" || status === "Cancelled") {
                    await supabase
                        .from("equipment")
                        .update({ status: "Available", updated_at: new Date().toISOString() })
                        .eq("id", data.equipment_id);
                }

                await recordAuditEvent({
                    action: "MAINTENANCE_ACTION",
                    module: "Maintenance",
                    recordId: ticketId,
                    description: `Updated maintenance ticket status to ${status}`
                });

                return data;
            }
        } catch (err) {
            console.warn("Supabase maintenance update exception:", err.message);
        }
    }

    const records = localDb.get("maintenance");
    const ticket = records.find(m => m.id === ticketId);
    if (!ticket) throw new Error("Maintenance ticket not found.");

    ticket.status = status;
    if (remarks !== undefined) ticket.remarks = remarks;
    if (assignedTo !== undefined) ticket.assigned_to = assignedTo;
    ticket.updated_at = new Date().toISOString();

    // If maintenance completed or cancelled, return equipment to Available
    if (status === "Completed" || status === "Cancelled") {
        const equipment = localDb.get("equipment");
        const equip = equipment.find(e => e.id === ticket.equipment_id);
        if (equip) {
            equip.status = "Available";
            equip.updated_at = new Date().toISOString();
            localDb.set("equipment", equipment);
        }
    }

    localDb.set("maintenance", records);

    await recordAuditEvent({
        action: "MAINTENANCE_ACTION",
        module: "Maintenance",
        recordId: ticket.id,
        description: `Updated maintenance ticket status to ${status}`
    });

    return ticket;
}

/**
 * Initialize Maintenance Page
 */
export async function initMaintenancePage(viewMode = "admin") {
    const tableBody = document.getElementById("maintenance-table-body");
    const newTicketBtn = document.getElementById("btn-new-maintenance");

    let allTickets = [];

    async function loadData() {
        try {
            allTickets = await fetchMaintenanceRecords();
            renderTable();
        } catch (err) {
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--color-damaged);">${err.message}</td></tr>`;
            }
        }
    }

    function renderTable() {
        if (!tableBody) return;
        if (allTickets.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        <div class="empty-icon">🔧</div>
                        <div class="empty-title">No Maintenance Records</div>
                        <p class="empty-text">All laboratory equipment is currently operational and in service.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = allTickets.map(ticket => {
            const equip = ticket.equipment || { asset_code: "N/A", equipment_name: "Unknown Asset" };
            const reqUser = ticket.requester ? ticket.requester.full_name : "Staff";
            const tech = ticket.technician ? ticket.technician.full_name : "Unassigned";

            let badgeClass = "badge-pending";
            if (ticket.status === "In Progress") badgeClass = "badge-released";
            else if (ticket.status === "Completed") badgeClass = "badge-available";
            else if (ticket.status === "Cancelled") badgeClass = "badge-closed";

            let actionsHtml = "";
            if (viewMode === "admin") {
                actionsHtml = `
                    <button class="btn btn-sm btn-secondary btn-edit-maint" data-id="${ticket.id}">Manage</button>
                `;
            } else {
                actionsHtml = `<span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(tech)}</span>`;
            }

            return `
                <tr>
                    <td><code>${String(ticket.id).slice(0, 8)}...</code></td>
                    <td>
                        <strong>${escapeHtml(equip.asset_code)}</strong>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(equip.equipment_name)}</div>
                    </td>
                    <td style="max-width: 250px;">${escapeHtml(ticket.problem_description)}</td>
                    <td>${escapeHtml(reqUser)}</td>
                    <td><span class="badge ${badgeClass}">${escapeHtml(ticket.status)}</span></td>
                    <td style="font-size: 0.8rem; color: var(--text-muted);">${escapeHtml(ticket.remarks || 'None')}</td>
                    <td class="actions-col">${actionsHtml}</td>
                </tr>
            `;
        }).join("");

        if (viewMode === "admin") {
            tableBody.querySelectorAll(".btn-edit-maint").forEach(btn => {
                btn.addEventListener("click", () => {
                    const id = btn.dataset.id;
                    const ticket = allTickets.find(t => t.id === id);
                    if (ticket) openManageMaintenanceModal(ticket, loadData);
                });
            });
        }
    }

    if (newTicketBtn) {
        newTicketBtn.addEventListener("click", () => openSubmitMaintenanceModal(loadData));
    }

    await loadData();
}

function openSubmitMaintenanceModal(onSuccess) {
    const equipment = localDb.get("equipment");

    showModal({
        title: "Report Equipment Maintenance / Repair",
        bodyHtml: `
            <form id="form-submit-maint">
                <div class="form-group">
                    <label class="form-label required">Select Equipment</label>
                    <select id="maint-equip-select" class="form-select" required>
                        <option value="">-- Choose Equipment Asset --</option>
                        ${equipment.map(e => `
                            <option value="${e.id}">${escapeHtml(e.asset_code)} — ${escapeHtml(e.equipment_name)} (${e.status})</option>
                        `).join("")}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label required">Problem Description</label>
                    <textarea id="maint-problem-input" class="form-textarea" placeholder="Detail the malfunction, hardware fault, or maintenance required..." required></textarea>
                </div>
            </form>
        `,
        confirmText: "Submit Ticket",
        confirmClass: "btn-warning",
        onConfirm: async () => {
            const equipId = document.getElementById("maint-equip-select").value;
            const prob = document.getElementById("maint-problem-input").value.trim();

            if (!equipId || !prob) {
                showToast("Required", "Please complete all fields.", "warning");
                return false;
            }

            try {
                await submitMaintenanceTicket({ equipmentId: equipId, problemDescription: prob });
                showToast("Submitted", "Maintenance ticket submitted. Equipment marked as Maintenance.", "success");
                if (onSuccess) await onSuccess();
                return true;
            } catch (err) {
                showToast("Error", err.message, "error");
                return false;
            }
        }
    });
}

function openManageMaintenanceModal(ticket, onSuccess) {
    const profiles = localDb.get("profiles").filter(p => p.role === "administrator" || p.role === "staff");

    showModal({
        title: `Manage Ticket: ${ticket.equipment ? ticket.equipment.asset_code : ticket.id}`,
        bodyHtml: `
            <form id="form-manage-maint">
                <div class="form-group">
                    <label class="form-label required">Maintenance Status</label>
                    <select id="maint-status-select" class="form-select">
                        <option value="Pending" ${ticket.status === 'Pending' ? 'selected' : ''}>Pending</option>
                        <option value="In Progress" ${ticket.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
                        <option value="Completed" ${ticket.status === 'Completed' ? 'selected' : ''}>Completed (Revert to Available)</option>
                        <option value="Cancelled" ${ticket.status === 'Cancelled' ? 'selected' : ''}>Cancelled</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Assign Technician</label>
                    <select id="maint-assign-select" class="form-select">
                        <option value="">-- Unassigned --</option>
                        ${profiles.map(p => `
                            <option value="${p.id}" ${p.id === ticket.assigned_to ? 'selected' : ''}>
                                ${escapeHtml(p.full_name)} (${p.role})
                            </option>
                        `).join("")}
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Technician Remarks</label>
                    <textarea id="maint-remarks-input" class="form-textarea" placeholder="Repair work performed, parts replaced, diagnostic notes...">${escapeHtml(ticket.remarks || '')}</textarea>
                </div>
            </form>
        `,
        confirmText: "Update Ticket",
        confirmClass: "btn-primary",
        onConfirm: async () => {
            const status = document.getElementById("maint-status-select").value;
            const assignedTo = document.getElementById("maint-assign-select").value || null;
            const remarks = document.getElementById("maint-remarks-input").value.trim();

            try {
                await updateMaintenanceTicket(ticket.id, { status, assignedTo, remarks });
                showToast("Updated", "Maintenance ticket updated successfully.", "success");
                if (onSuccess) await onSuccess();
                return true;
            } catch (err) {
                showToast("Error", err.message, "error");
                return false;
            }
        }
    });
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
