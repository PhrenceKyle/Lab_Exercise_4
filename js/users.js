/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * User Management Module: Profile Administration, Roles & Status Controls
 * =====================================================================
 */

import { supabase, supabaseConfig, localDb } from "./supabase.js";
import { session } from "./session.js";
import { recordAuditEvent } from "./audit.js";
import { showToast, showConfirm, renderRoleBadge } from "./ui.js";

export async function fetchUsers() {
    const role = session.getRole();
    if (role !== "administrator") {
        throw new Error("Access Denied: Only Administrator may view or manage user accounts.");
    }

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: true });
            if (error) throw error;
            return data;
        } catch (err) {
            console.error("Supabase users fetch error:", err);
            throw err;
        }
    }

    return localDb.get("profiles");
}

export async function toggleUserStatus(userId) {
    const role = session.getRole();
    const currentProfile = session.getProfile();

    if (role !== "administrator") {
        throw new Error("Access Denied: Only Administrator may change user status.");
    }

    if (userId === currentProfile.id) {
        throw new Error("Security Restriction: You cannot deactivate your own administrative account.");
    }

    let user = localDb.get("profiles").find(p => p.id === userId);
    if (!user && supabaseConfig.isConfigured() && supabase) {
        try {
            const { data } = await supabase.from("profiles").select("*").eq("id", userId).single();
            if (data) user = data;
        } catch (e) {}
    }
    if (!user) throw new Error("User not found.");

    const newStatus = user.status === "active" ? "inactive" : "active";

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            await supabase.from("profiles").update({ status: newStatus }).eq("id", userId);
        } catch (err) {
            console.warn("Supabase toggle user status exception:", err.message);
        }
    }

    const profiles = localDb.get("profiles");
    const localUser = profiles.find(p => p.id === userId);
    if (localUser) {
        localUser.status = newStatus;
        localUser.updated_at = new Date().toISOString();
        localDb.set("profiles", profiles);
    }

    await recordAuditEvent({
        action: "CHANGE_USER_STATUS",
        module: "Users",
        recordId: userId,
        description: `Changed status of ${user.full_name} (${user.email}) to ${newStatus}`
    });

    return newStatus;
}

export async function initUsersPage() {
    const tableBody = document.getElementById("users-table-body");
    const searchInput = document.getElementById("users-search");

    let allUsers = [];

    async function loadData() {
        try {
            allUsers = await fetchUsers();
            renderTable();
        } catch (err) {
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--color-damaged);">${err.message}</td></tr>`;
            }
        }
    }

    function renderTable() {
        if (!tableBody) return;
        const query = (searchInput ? searchInput.value : "").toLowerCase().trim();

        const filtered = allUsers.filter(u => {
            return !query ||
                u.full_name.toLowerCase().includes(query) ||
                u.email.toLowerCase().includes(query) ||
                u.role.toLowerCase().includes(query);
        });

        tableBody.innerHTML = filtered.map(u => {
            const isSelf = u.id === session.getProfile().id;
            const statusBadge = u.status === "active"
                ? `<span class="badge badge-available">Active</span>`
                : `<span class="badge badge-damaged">Inactive</span>`;

            const actionBtn = isSelf
                ? `<span style="font-size: 0.75rem; color: var(--text-light);">Current Account</span>`
                : `<button class="btn btn-sm ${u.status === 'active' ? 'btn-danger' : 'btn-success'} btn-toggle-status" data-id="${u.id}" data-name="${escapeHtml(u.full_name)}" data-status="${u.status}">
                    ${u.status === 'active' ? 'Deactivate' : 'Activate'}
                   </button>`;

            return `
                <tr>
                    <td><strong>${escapeHtml(u.full_name)}</strong></td>
                    <td>${escapeHtml(u.email)}</td>
                    <td>${renderRoleBadge(u.role)}</td>
                    <td>${statusBadge}</td>
                    <td>${new Date(u.created_at).toLocaleDateString()}</td>
                    <td class="actions-col">${actionBtn}</td>
                </tr>
            `;
        }).join("");

        tableBody.querySelectorAll(".btn-toggle-status").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const name = btn.dataset.name;
                const status = btn.dataset.status;
                const nextStatus = status === "active" ? "deactivate" : "activate";

                showConfirm(
                    `${nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1)} User Account`,
                    `Are you sure you want to ${nextStatus} ${name}'s account?`,
                    async () => {
                        try {
                            await toggleUserStatus(id);
                            showToast("Status Updated", `Account has been ${nextStatus}d.`, "success");
                            await loadData();
                        } catch (err) {
                            showToast("Error", err.message, "error");
                        }
                    },
                    nextStatus.charAt(0).toUpperCase() + nextStatus.slice(1),
                    status === "active" ? "btn-danger" : "btn-success"
                );
            });
        });
    }

    if (searchInput) searchInput.addEventListener("input", renderTable);
    await loadData();
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
