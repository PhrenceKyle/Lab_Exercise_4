/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * Equipment Management Engine: CRUD, Availability Rules & Role Restrictions
 * =====================================================================
 */

import { supabase, supabaseConfig, localDb, getSupabaseAuthSession } from "./supabase.js?v=2.6";
import { session } from "./session.js?v=2.6";
import { recordAuditEvent } from "./audit.js?v=2.6";
import { showToast, showModal, showConfirm, closeModal, renderEquipmentStatusBadge } from "./ui.js?v=2.6";

async function requireEquipmentAuth(operation) {
    if (!supabaseConfig.isConfigured() || !supabase) {
        throw new Error(`Cannot ${operation} equipment: Supabase is not configured.`);
    }

    const authSession = await getSupabaseAuthSession();
    if (!authSession?.user?.id) {
        session.clearSession();
        const loginPath = window.location.pathname.includes("/pages/") ? "../../login.html?v=2.6" : "./login.html?v=2.6";
        window.location.replace(loginPath);
        throw new Error(`Authentication required to ${operation} equipment. Please sign in with Supabase Auth.`);
    }

    return authSession;
}

/**
 * Fetch equipment catalog
 */
export async function fetchEquipment() {
    if (supabaseConfig.isConfigured() && supabase) {
        await requireEquipmentAuth("load");
        try {
            const { data, error } = await supabase
                .from("equipment")
                .select("*")
                .order("asset_code", { ascending: true });
            if (error) {
                console.error("Error fetching Supabase equipment:", error);
                throw error;
            }
            if (Array.isArray(data)) {
                localDb.set("equipment", data);
            }
            return data || [];
        } catch (err) {
            console.error("Error fetching Supabase equipment:", err);
            throw new Error(`Unable to load equipment from Supabase: ${err.message || "database request failed"}`);
        }
    }
    return localDb.get("equipment") || [];
}

/**
 * Add Equipment (Admin & Staff)
 */
export async function addEquipment(item) {
    const role = session.getRole();
    if (role !== "administrator" && role !== "staff") {
        await recordAuditEvent({
            action: "ACCESS_DENIED",
            module: "Equipment",
            description: `Unauthorized attempt to add equipment by role '${role}'`
        });
        throw new Error("Access Denied: Only Administrator and Staff may add equipment.");
    }

    if (!item.asset_code || !item.equipment_name || !item.category || !item.location) {
        throw new Error("Please fill in all required fields.");
    }

    item.asset_code = item.asset_code.trim().toUpperCase();

    if (supabaseConfig.isConfigured() && supabase) {
        const authSession = await requireEquipmentAuth("insert");
        const currentProfile = session.getProfile();
        await supabase.from("profiles").upsert({
            id: authSession.user.id,
            email: authSession.user.email,
            full_name: (currentProfile && currentProfile.full_name) || (authSession.user.user_metadata?.full_name) || "Laboratory Staff/Admin",
            role: role,
            status: "active"
        });

            const payload = {
                asset_code: item.asset_code,
                equipment_name: item.equipment_name,
                category: item.category,
                description: item.description || null,
                location: item.location,
                condition: item.condition || "Good",
                status: item.status || "Available",
                serial_number: item.serial_number || null,
                quantity: item.quantity !== undefined ? Number(item.quantity) : 1
            };

            let { data, error } = await supabase.from("equipment").insert([payload]).select().single();

            // If error is due to missing 'quantity' column in Supabase schema, retry without it
            if (error && (error.message.includes("quantity") || (error.details && error.details.includes("quantity")) || error.code === "PGRST204")) {
                console.warn("Retrying equipment insertion without 'quantity' column:", error.message);
                delete payload.quantity;
                const retry = await supabase.from("equipment").insert([payload]).select().single();
                data = retry.data;
                error = retry.error;
            }

            if (error) {
                console.error("Supabase equipment insert error:", error);
                if (error.message.includes("row-level security")) {
                    throw new Error("Supabase Permission Error: Row-Level Security blocked this action. Please execute 'database/fix-rls.sql' in your Supabase SQL Editor to grant permission.");
                }
                throw new Error(`Failed to save equipment to Supabase: ${error.message}`);
            }

            if (data) {
                const items = localDb.get("equipment") || [];
                const idx = items.findIndex(e => e.id === data.id || e.asset_code === data.asset_code);
                if (idx >= 0) {
                    items[idx] = data;
                } else {
                    items.unshift(data);
                }
                localDb.set("equipment", items);

                await recordAuditEvent({
                    action: "CREATE_EQUIPMENT",
                    module: "Equipment",
                    recordId: data.id,
                    description: `Created new equipment asset ${data.asset_code} (${data.equipment_name}) in Supabase`
                });
                return data;
            }
    }

    const items = localDb.get("equipment");
    if (items.some(e => e.asset_code === item.asset_code)) {
        throw new Error(`Asset code ${item.asset_code} already exists.`);
    }

    const newItem = {
        ...item,
        id: "e0000000-0000-0000-0000-" + String(Date.now()).slice(-12).padStart(12, "0"),
        status: item.status || "Available",
        condition: item.condition || "Good",
        quantity: item.quantity || 1,
        created_at: new Date().toISOString()
    };

    items.push(newItem);
    localDb.set("equipment", items);

    await recordAuditEvent({
        action: "CREATE_EQUIPMENT",
        module: "Equipment",
        recordId: newItem.id,
        description: `Created new equipment asset ${newItem.asset_code} (${newItem.equipment_name})`
    });

    return newItem;
}

/**
 * Update Equipment (Admin & Staff)
 */
export async function updateEquipment(id, updates) {
    const role = session.getRole();
    if (role !== "administrator" && role !== "staff") {
        await recordAuditEvent({
            action: "ACCESS_DENIED",
            module: "Equipment",
            recordId: id,
            description: `Unauthorized attempt to update equipment by role '${role}'`
        });
        throw new Error("Access Denied: Only Administrator and Staff may update equipment records.");
    }

    if (supabaseConfig.isConfigured() && supabase) {
        await requireEquipmentAuth("update");
            const updatePayload = { ...updates, updated_at: new Date().toISOString() };
            let { data, error } = await supabase
                .from("equipment")
                .update(updatePayload)
                .eq("id", id)
                .select()
                .single();

            // If error is due to missing 'quantity' column in Supabase schema, retry without it
            if (error && (error.message.includes("quantity") || (error.details && error.details.includes("quantity")) || error.code === "PGRST204")) {
                console.warn("Retrying equipment update without 'quantity' column:", error.message);
                delete updatePayload.quantity;
                const retry = await supabase
                    .from("equipment")
                    .update(updatePayload)
                    .eq("id", id)
                    .select()
                    .single();
                data = retry.data;
                error = retry.error;
            }

            if (error) {
                console.error("Supabase equipment update error:", error);
                if (error.message.includes("row-level security")) {
                    throw new Error("Supabase Permission Error: Row-Level Security blocked this update. Please run 'database/fix-rls.sql' in your Supabase SQL Editor.");
                }
                throw new Error(`Failed to update equipment in Supabase: ${error.message}`);
            }

            if (data) {
                const items = localDb.get("equipment") || [];
                const idx = items.findIndex(e => e.id === id);
                if (idx >= 0) {
                    items[idx] = data;
                } else {
                    items.unshift(data);
                }
                localDb.set("equipment", items);

                await recordAuditEvent({
                    action: "UPDATE_EQUIPMENT",
                    module: "Equipment",
                    recordId: id,
                    description: `Updated equipment asset ${data.asset_code} in Supabase`
                });
                return data;
            }
    }

    const items = localDb.get("equipment");
    const idx = items.findIndex(e => e.id === id);
    if (idx === -1) throw new Error("Equipment not found.");

    items[idx] = { ...items[idx], ...updates, updated_at: new Date().toISOString() };
    localDb.set("equipment", items);

    await recordAuditEvent({
        action: "UPDATE_EQUIPMENT",
        module: "Equipment",
        recordId: id,
        description: `Updated equipment asset ${items[idx].asset_code}`
    });

    return items[idx];
}

/**
 * Restricted Delete (Admin Only, TC-A4-09)
 */
export async function deleteEquipment(id) {
    const role = session.getRole();
    if (role !== "administrator") {
        await recordAuditEvent({
            action: "ACCESS_DENIED",
            module: "Equipment",
            recordId: id,
            description: `TC-A4-09: Staff/Requester role '${role}' attempted restricted delete on equipment ${id}`
        });
        throw new Error("Access Denied: You do not have permission to delete equipment records.");
    }

    if (supabaseConfig.isConfigured() && supabase) {
        await requireEquipmentAuth("delete");
        const { data: activeBorrowings } = await supabase
            .from("borrowing_requests")
            .select("id")
            .eq("equipment_id", id)
            .in("status", ["Approved", "Released", "Overdue"]);
        if (activeBorrowings && activeBorrowings.length > 0) {
            throw new Error("Cannot delete equipment that has active or released borrowing requests.");
        }
    }

    // Check if equipment is currently borrowed in localDb
    const items = localDb.get("equipment");
    const item = items.find(e => e.id === id);
    if (item && item.status === "Borrowed") {
        throw new Error("Cannot delete equipment that is currently borrowed by a user.");
    }

    if (supabaseConfig.isConfigured() && supabase) {
        const { error } = await supabase.from("equipment").delete().eq("id", id);
        if (error) {
            console.error("Supabase equipment delete error:", error);
            if (error.message.includes("row-level security")) {
                throw new Error("Supabase Permission Error: Row-Level Security blocked deletion. Please run 'database/fix-rls.sql' in your Supabase SQL Editor.");
            }
            throw new Error(`Failed to delete equipment from Supabase: ${error.message}`);
        }
    }

    const remaining = items.filter(e => e.id !== id);
    localDb.set("equipment", remaining);

    await recordAuditEvent({
        action: "DELETE_EQUIPMENT",
        module: "Equipment",
        recordId: id,
        description: `Deleted equipment record ${item ? item.asset_code : id}`
    });

    return true;
}

/**
 * Initialize Equipment Catalog Page
 */
export async function initEquipmentPage(viewMode = "admin") {
    const tableBody = document.getElementById("equipment-table-body");
    const searchInput = document.getElementById("equipment-search");
    const categoryFilter = document.getElementById("equipment-category-filter");
    const statusFilter = document.getElementById("equipment-status-filter");
    const addBtn = document.getElementById("btn-add-equipment");

    let allEquipment = [];

    async function loadData() {
        try {
            allEquipment = await fetchEquipment();
            renderTable();
        } catch (err) {
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center; color: var(--color-damaged);">${err.message}</td></tr>`;
            }
        }
    }

    function renderTable() {
        if (!tableBody) return;
        const query = (searchInput ? searchInput.value : "").toLowerCase().trim();
        const cat = categoryFilter ? categoryFilter.value : "";
        const stat = statusFilter ? statusFilter.value : "";

        const filtered = allEquipment.filter(e => {
            const matchQuery = !query ||
                e.asset_code.toLowerCase().includes(query) ||
                e.equipment_name.toLowerCase().includes(query) ||
                (e.description && e.description.toLowerCase().includes(query)) ||
                e.location.toLowerCase().includes(query);

            const matchCat = !cat || e.category === cat;
            const matchStat = !stat || e.status === stat;

            return matchQuery && matchCat && matchStat;
        });

        if (filtered.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <div class="empty-icon">💻</div>
                        <div class="empty-title">No Equipment Found</div>
                        <p class="empty-text">No equipment records match the selected criteria.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = filtered.map(item => {
            let actionsHtml = "";

            if (viewMode === "admin") {
                actionsHtml = `
                    <button class="btn btn-sm btn-secondary btn-edit-equip" data-id="${item.id}" title="Edit">✏️ Edit</button>
                    <button class="btn btn-sm btn-danger btn-delete-equip" data-id="${item.id}" title="Delete">🗑️</button>
                `;
            } else if (viewMode === "staff") {
                actionsHtml = `
                    <button class="btn btn-sm btn-secondary btn-edit-equip" data-id="${item.id}" title="Update Equipment & Availability">✏️ Edit</button>
                `;
            } else if (viewMode === "requester") {
                if (item.status === "Available") {
                    actionsHtml = `<a href="./request.html?equipmentId=${item.id}" class="btn btn-sm btn-primary">⚡ Request</a>`;
                } else {
                    actionsHtml = `<span style="font-size: 0.75rem; color: var(--text-light); font-weight: 500;">Unavailable</span>`;
                }
            } else {
                actionsHtml = `<span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(item.location)}</span>`;
            }

            return `
                <tr>
                    <td><strong><code>${escapeHtml(item.asset_code)}</code></strong></td>
                    <td>
                        <div style="font-weight: 600; color: var(--primary-900);">${escapeHtml(item.equipment_name)}</div>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(item.description || '')}</div>
                    </td>
                    <td>${escapeHtml(item.category)}</td>
                    <td>${escapeHtml(item.location)}</td>
                    <td>${escapeHtml(item.condition)}</td>
                    <td>${renderEquipmentStatusBadge(item.status)}</td>
                    <td>
                        <div style="font-weight: 600; font-size: 0.85rem; color: var(--brand-blue);">Qty: ${item.quantity || 1}</div>
                        <code style="font-size: 0.72rem; color: var(--text-muted);">${escapeHtml(item.serial_number || 'N/A')}</code>
                    </td>
                    <td class="actions-col">${actionsHtml}</td>
                </tr>
            `;
        }).join("");

        // Attach action events for Admin and Staff
        if (viewMode === "admin" || viewMode === "staff") {
            tableBody.querySelectorAll(".btn-edit-equip").forEach(btn => {
                btn.addEventListener("click", () => {
                    const id = btn.dataset.id;
                    const item = allEquipment.find(e => e.id === id);
                    if (item) openEditEquipmentModal(item, loadData);
                });
            });

            tableBody.querySelectorAll(".btn-delete-equip").forEach(btn => {
                btn.addEventListener("click", () => {
                    const id = btn.dataset.id;
                    const item = allEquipment.find(e => e.id === id);
                    showConfirm(
                        "Delete Equipment Record",
                        `Are you sure you want to permanently delete ${item ? item.asset_code : 'this equipment'}? This action cannot be undone.`,
                        async () => {
                            try {
                                await deleteEquipment(id);
                                showToast("Deleted", "Equipment deleted successfully.", "success");
                                await loadData();
                            } catch (err) {
                                showToast("Action Blocked", err.message, "error");
                            }
                        },
                        "Delete Record",
                        "btn-danger"
                    );
                });
            });
        }
    }

    if (addBtn && (viewMode === "admin" || viewMode === "staff")) {
        addBtn.addEventListener("click", () => openAddEquipmentModal(loadData));
    }

    if (searchInput) searchInput.addEventListener("input", renderTable);
    if (categoryFilter) categoryFilter.addEventListener("change", renderTable);
    if (statusFilter) statusFilter.addEventListener("change", renderTable);

    await loadData();
}

function openAddEquipmentModal(onSuccess) {
    showModal({
        title: "Add New Laboratory Equipment",
        bodyHtml: `
            <form id="form-add-equip">
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label required">Asset Code</label>
                        <input type="text" id="add-asset-code" class="form-control" placeholder="e.g. LAP-003" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label required">Category</label>
                        <select id="add-category" class="form-select" required>
                            <option value="Laptops">Laptops</option>
                            <option value="Projectors">Projectors</option>
                            <option value="Monitors">Monitors</option>
                            <option value="Cameras">Cameras</option>
                            <option value="Electronics">Electronics</option>
                            <option value="IoT / Embedded">IoT / Embedded</option>
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label required">Equipment Name</label>
                    <input type="text" id="add-name" class="form-control" placeholder="e.g. Dell Precision 3561" required>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label required">Location</label>
                        <input type="text" id="add-location" class="form-control" placeholder="e.g. Lab Room 301 - Cabinet B" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label required">Quantity</label>
                        <input type="number" id="add-quantity" class="form-control" value="1" min="1" required>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Serial Number</label>
                    <input type="text" id="add-serial" class="form-control" placeholder="e.g. SN-98124">
                </div>
                <div class="form-group">
                    <label class="form-label">Description / Specifications</label>
                    <textarea id="add-desc" class="form-textarea" placeholder="Detailed hardware specs, accessories included..."></textarea>
                </div>
            </form>
        `,
        confirmText: "Add Equipment",
        confirmClass: "btn-primary",
        onConfirm: async () => {
            const assetCode = document.getElementById("add-asset-code").value.trim();
            const name = document.getElementById("add-name").value.trim();
            const category = document.getElementById("add-category").value;
            const location = document.getElementById("add-location").value.trim();
            const qty = parseInt(document.getElementById("add-quantity").value || "1", 10);
            const serial = document.getElementById("add-serial").value.trim();
            const desc = document.getElementById("add-desc").value.trim();

            if (!assetCode || !name || !location) {
                showToast("Validation Error", "Please fill in all required fields.", "warning");
                return false;
            }

            try {
                await addEquipment({
                    asset_code: assetCode,
                    equipment_name: name,
                    category,
                    location,
                    quantity: qty,
                    serial_number: serial,
                    description: desc,
                    status: "Available",
                    condition: "Good"
                });
                showToast("Created", `Equipment ${assetCode} added successfully.`, "success");
                if (onSuccess) await onSuccess();
                return true;
            } catch (err) {
                showToast("Error", err.message, "error");
                return false;
            }
        }
    });
}

function openEditEquipmentModal(item, onSuccess) {
    showModal({
        title: `Edit Equipment: ${item.asset_code}`,
        bodyHtml: `
            <form id="form-edit-equip">
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label required">Equipment Name</label>
                        <input type="text" id="edit-name" class="form-control" value="${escapeHtml(item.equipment_name)}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label required">Status</label>
                        <select id="edit-status" class="form-select">
                            <option value="Available" ${item.status === 'Available' ? 'selected' : ''}>Available</option>
                            <option value="Borrowed" ${item.status === 'Borrowed' ? 'selected' : ''}>Borrowed</option>
                            <option value="Maintenance" ${item.status === 'Maintenance' ? 'selected' : ''}>Maintenance</option>
                            <option value="Damaged" ${item.status === 'Damaged' ? 'selected' : ''}>Damaged</option>
                            <option value="Retired" ${item.status === 'Retired' ? 'selected' : ''}>Retired</option>
                        </select>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="form-label required">Location</label>
                        <input type="text" id="edit-location" class="form-control" value="${escapeHtml(item.location)}" required>
                    </div>
                    <div class="form-group">
                        <label class="form-label required">Quantity</label>
                        <input type="number" id="edit-quantity" class="form-control" value="${item.quantity || 1}" min="1" required>
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Condition</label>
                    <select id="edit-condition" class="form-select">
                        <option value="Good" ${item.condition === 'Good' ? 'selected' : ''}>Good</option>
                        <option value="Fair" ${item.condition === 'Fair' ? 'selected' : ''}>Fair</option>
                        <option value="Poor" ${item.condition === 'Poor' ? 'selected' : ''}>Poor</option>
                        <option value="Damaged" ${item.condition === 'Damaged' ? 'selected' : ''}>Damaged</option>
                    </select>
                </div>
                <div class="form-group">
                    <label class="form-label">Description</label>
                    <textarea id="edit-desc" class="form-textarea">${escapeHtml(item.description || '')}</textarea>
                </div>
            </form>
        `,
        confirmText: "Save Changes",
        confirmClass: "btn-primary",
        onConfirm: async () => {
            const name = document.getElementById("edit-name").value.trim();
            const status = document.getElementById("edit-status").value;
            const location = document.getElementById("edit-location").value.trim();
            const qty = parseInt(document.getElementById("edit-quantity").value || "1", 10);
            const condition = document.getElementById("edit-condition").value;
            const desc = document.getElementById("edit-desc").value.trim();

            try {
                await updateEquipment(item.id, {
                    equipment_name: name,
                    status,
                    location,
                    quantity: qty,
                    condition,
                    description: desc
                });
                showToast("Updated", `Equipment ${item.asset_code} updated successfully.`, "success");
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
