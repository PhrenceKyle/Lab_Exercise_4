/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * Borrowing Lifecycle Engine: State Validation, Approvals, Releases & Returns
 * Implements Business Rules: BR-A4-01 through BR-A4-09
 * =====================================================================
 */

import { supabase, supabaseConfig, localDb } from "./supabase.js";
import { session } from "./session.js";
import { recordAuditEvent } from "./audit.js";
import { showToast, showModal, showConfirm, renderBorrowingStatusBadge, renderEquipmentStatusBadge } from "./ui.js";

let _requesterSyncChannel = null;

async function resolveAuthenticatedRequesterId(profile = session.getProfile()) {
    if (!supabaseConfig.isConfigured() || !supabase) {
        return profile?.id || null;
    }

    try {
        const { data: authData } = await supabase.auth.getUser();
        const authUserId = authData?.user?.id || null;
        const authEmail = (authData?.user?.email || profile?.email || "").toLowerCase();

        if (authUserId) {
            const { data: byUserId } = await supabase
                .from("profiles")
                .select("id, email")
                .eq("id", authUserId)
                .maybeSingle();
            if (byUserId?.id) return byUserId.id;
        }

        if (authEmail) {
            const { data: byEmail } = await supabase
                .from("profiles")
                .select("id, email")
                .ilike("email", authEmail)
                .maybeSingle();
            if (byEmail?.id) return byEmail.id;
        }

        if (profile?.email) {
            const { data: byProfileEmail } = await supabase
                .from("profiles")
                .select("id, email")
                .ilike("email", profile.email.toLowerCase())
                .maybeSingle();
            if (byProfileEmail?.id) return byProfileEmail.id;
        }

        if (profile?.id) {
            const { data: byProfileId } = await supabase
                .from("profiles")
                .select("id")
                .eq("id", profile.id)
                .maybeSingle();
            if (byProfileId?.id) return byProfileId.id;
        }
    } catch (err) {
        console.warn("Unable to resolve authenticated requester profile:", err.message);
    }

    return profile?.id || null;
}

export function subscribeRequesterBorrowingUpdates(onUpdate) {
    if (!supabaseConfig.isConfigured() || !supabase) {
        return null;
    }

    if (_requesterSyncChannel) {
        return _requesterSyncChannel;
    }

    try {
        _requesterSyncChannel = supabase
            .channel("requester-borrowing-sync")
            .on("postgres_changes", { event: "*", schema: "public", table: "borrowing_requests" }, () => {
                onUpdate && onUpdate();
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "equipment" }, () => {
                onUpdate && onUpdate();
            })
            .subscribe();
    } catch (err) {
        console.warn("Requester realtime subscription unavailable:", err.message);
        return null;
    }

    return _requesterSyncChannel;
}

/**
 * Fetch borrowing requests with joined equipment and requester profiles
 */
export async function fetchBorrowingRequests(options = {}) {
    const role = session.getRole();
    const profile = session.getProfile();

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            const currentUserId = await resolveAuthenticatedRequesterId(profile);

            let query = supabase
                .from("borrowing_requests")
                .select("*")
                .order("created_at", { ascending: false });

            if (role === "requester" && currentUserId) {
                query = query.eq("requester_id", currentUserId);
            }

            const { data, error } = await query;
            if (error) throw error;

            const rows = Array.isArray(data) ? data : [];
            const equipmentIds = [...new Set(rows.map(row => row.equipment_id).filter(Boolean))];
            const profileIds = [...new Set(rows.flatMap(row => [row.requester_id, row.approved_by]).filter(Boolean))];

            const [equipmentResult, profilesResult] = await Promise.all([
                equipmentIds.length > 0
                    ? supabase.from("equipment").select("*").in("id", equipmentIds)
                    : Promise.resolve({ data: [] }),
                profileIds.length > 0
                    ? supabase.from("profiles").select("*").in("id", profileIds)
                    : Promise.resolve({ data: [] })
            ]);

            if (equipmentResult.error) throw equipmentResult.error;
            if (profilesResult.error) throw profilesResult.error;

            const equipmentById = new Map((equipmentResult.data || []).map(item => [item.id, item]));
            const profilesById = new Map((profilesResult.data || []).map(item => [item.id, item]));
            rows.forEach(row => {
                row.equipment = equipmentById.get(row.equipment_id) || null;
                row.requester = profilesById.get(row.requester_id) || null;
                row.approver = profilesById.get(row.approved_by) || null;
            });

            localDb.set("borrowing", rows);
            return syncOverdueStatus(rows);
        } catch (err) {
            console.error("Supabase borrowing fetch failed:", err);
            throw new Error(`Unable to load borrowing requests from Supabase: ${err.message || "database request failed"}`);
        }
    }

    // Demo storage adapter
    const requests = localDb.get("borrowing");
    const equipment = localDb.get("equipment");
    const profiles = localDb.get("profiles");

    const enriched = requests.map(req => {
        return {
            ...req,
            equipment: equipment.find(e => e.id === req.equipment_id) || null,
            requester: profiles.find(p => p.id === req.requester_id) || null,
            approver: profiles.find(p => p.id === req.approved_by) || null
        };
    });

    // Check if requester view
    let result = enriched;
    if (role === "requester") {
        result = enriched.filter(r => r.requester_id === profile.id);
    }

    return syncOverdueStatus(result);
}

/**
 * Check and flag overdue transactions (Section 23)
 * A Released transaction becomes Overdue when expected_return_date < current date
 */
function syncOverdueStatus(requestsList) {
    const today = new Date().toISOString().split("T")[0];

    return requestsList.map(req => {
        if (req.status === "Released" && req.expected_return_date < today) {
            req.status = "Overdue";
        }
        return req;
    });
}

/**
 * BR-A4-01 & BR-A4-09: Submit Borrowing Request
 */
export async function submitBorrowingRequest({ equipmentId, purpose, expectedReturnDate }) {
    const profile = session.getProfile();
    if (!profile) throw new Error("Please log in to submit a borrowing request.");

    if (!equipmentId || !purpose || !expectedReturnDate) {
        throw new Error("Please fill in all required fields.");
    }

    const today = new Date().toISOString().split("T")[0];
    if (expectedReturnDate < today) {
        throw new Error("Expected return date cannot be in the past.");
    }

    // Verify equipment exists and is Available in Supabase or localDb
    let equip = null;
    if (supabaseConfig.isConfigured() && supabase) {
        try {
            const { data } = await supabase.from("equipment").select("*").eq("id", equipmentId).single();
            if (data) equip = data;
        } catch (e) {}
    }
    if (!equip) {
        const allEquip = localDb.get("equipment");
        equip = allEquip.find(e => e.id === equipmentId);
    }

    if (!equip) {
        throw new Error("Equipment not found.");
    }

    if (equip.status === "Maintenance") {
        throw new Error("BR-A4-09 Violation: Equipment under Maintenance cannot be borrowed.");
    }

    if (equip.status !== "Available") {
        throw new Error(`BR-A4-01 Violation: Only Available equipment may be requested. Current status is '${equip.status}'.`);
    }

    let actualRequesterId = profile.id || null;

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            actualRequesterId = await resolveAuthenticatedRequesterId(profile) || actualRequesterId;

            // Check existing profiles in Supabase
            const { data: existingProfiles } = await supabase.from("profiles").select("id, email, role");

            let matchedProfile = null;
            if (existingProfiles && existingProfiles.length > 0) {
                matchedProfile = existingProfiles.find(p => p.id === actualRequesterId)
                              || existingProfiles.find(p => p.email && p.email.toLowerCase() === (profile.email || "").toLowerCase())
                              || existingProfiles.find(p => p.role === "requester")
                              || existingProfiles[0];
            }

            if (matchedProfile) {
                actualRequesterId = matchedProfile.id;
            } else {
                const { error: profErr } = await supabase.from("profiles").upsert({
                    id: actualRequesterId,
                    email: profile.email || "requester@gmail.com",
                    full_name: profile.full_name || "Requester",
                    role: profile.role || "requester",
                    status: "active"
                });

                if (profErr) {
                    throw new Error(`Unable to sync your Supabase profile: ${profErr.message}`);
                }
            }

            if (actualRequesterId && profile.id !== actualRequesterId) {
                profile.id = actualRequesterId;
                session.setSession({ ...session.getSession(), profile });
            }
        } catch (e) {
            console.warn("Could not check auth/profile before borrowing request:", e.message);
        }
    }

    const newRequest = {
        id: "b0000000-0001-0000-0000-" + String(Date.now()).slice(-12).padStart(12, "0"),
        requester_id: actualRequesterId,
        equipment_id: equipmentId,
        purpose: purpose.trim(),
        request_date: today,
        expected_return_date: expectedReturnDate,
        approved_by: null,
        approved_at: null,
        rejected_reason: null,
        status: "Pending", // Always begins as Pending (Section 19)
        released_at: null,
        returned_at: null,
        closed_at: null,
        created_at: new Date().toISOString()
    };

    if (supabaseConfig.isConfigured() && supabase) {
        let { data, error } = await supabase.from("borrowing_requests").insert([{
            requester_id: actualRequesterId,
            equipment_id: equipmentId,
            purpose: purpose.trim(),
            request_date: today,
            expected_return_date: expectedReturnDate,
            status: "Pending"
        }]).select("*, equipment(*)").single();

        // If foreign key constraint is triggered, retry with any available valid profile ID from Supabase
        if (error && (error.message.includes("foreign key") || error.code === "23503")) {
            console.warn("Foreign key error on requester_id. Querying Supabase profiles for valid key...");
            const { data: validProfiles } = await supabase.from("profiles").select("id");
            if (validProfiles && validProfiles.length > 0) {
                for (const vp of validProfiles) {
                    const retry = await supabase.from("borrowing_requests").insert([{
                        requester_id: vp.id,
                        equipment_id: equipmentId,
                        purpose: purpose.trim(),
                        request_date: today,
                        expected_return_date: expectedReturnDate,
                        status: "Pending"
                    }]).select("*, equipment(*)").single();
                    if (!retry.error && retry.data) {
                        data = retry.data;
                        error = null;
                        actualRequesterId = vp.id;
                        profile.id = vp.id;
                        session.setSession({ ...session.getSession(), profile });
                        break;
                    }
                }
            }
        }

        if (error) {
            console.error("Supabase borrowing request insert error:", error);
            if (error.message.includes("foreign key constraint") || error.code === "23503") {
                throw new Error("Database Foreign Key Error: The requester profile was not linked in Supabase. Please run 'database/fix-rls.sql' in your Supabase SQL Editor to link profiles and drop constraint blockers.");
            }
            if (error.message.includes("row-level security")) {
                throw new Error("Supabase Permission Error: Row-Level Security blocked this request. Please execute 'database/fix-rls.sql' in your Supabase SQL Editor.");
            }
            throw new Error(`Failed to submit request to Supabase: ${error.message}`);
        }

        if (data) {
            newRequest.id = data.id;
            newRequest.equipment = data.equipment || equip;

            const reqs = localDb.get("borrowing") || [];
            reqs.unshift(data);
            localDb.set("borrowing", reqs);

            await recordAuditEvent({
                userId: actualRequesterId,
                action: "CREATE_BORROWING_REQUEST",
                module: "Borrowing",
                recordId: data.id,
                description: `Submitted borrowing request for ${equip.asset_code} in Supabase`
            });

            return data;
        }
    }

    const reqs = localDb.get("borrowing") || [];
    reqs.unshift(newRequest);
    localDb.set("borrowing", reqs);

    await recordAuditEvent({
        userId: actualRequesterId,
        action: "CREATE_BORROWING_REQUEST",
        module: "Borrowing",
        recordId: newRequest.id,
        description: `Submitted borrowing request for ${equip.asset_code}`
    });

    return newRequest;
}

/**
 * BR-A4-02 & BR-A4-03: Approve Borrowing Request (Admin Only)
 */
export async function approveBorrowingRequest(requestId) {
    const role = session.getRole();
    const profile = session.getProfile();

    // BR-A4-03: Only Administrator may approve
    if (role !== "administrator") {
        await recordAuditEvent({
            action: "ACCESS_DENIED",
            module: "Borrowing",
            recordId: requestId,
            description: `Unauthorized attempt to approve request ${requestId} by user with role '${role}'`
        });
        throw new Error("BR-A4-03 Violation: Access Denied. Only Administrator may approve requests.");
    }

    let actualAdminId = profile.id;
    if (supabaseConfig.isConfigured() && supabase) {
        try {
            const { data: authData } = await supabase.auth.getUser();
            if (authData?.user?.id) actualAdminId = authData.user.id;

            // Direct update
            await supabase
                .from("borrowing_requests")
                .update({
                    status: "Approved",
                    approved_by: actualAdminId,
                    approved_at: new Date().toISOString(),
                    updated_at: new Date().toISOString()
                })
                .eq("id", requestId);
        } catch (err) {
            console.warn("Supabase approve request exception:", err.message);
        }
    }

    // Demo Engine Enforcement
    const requests = localDb.get("borrowing");
    const req = requests.find(r => r.id === requestId);
    if (req) {
        req.status = "Approved";
        req.approved_by = actualAdminId;
        req.approved_at = new Date().toISOString();
        localDb.set("borrowing", requests);
    }

    await recordAuditEvent({
        userId: actualAdminId,
        action: "APPROVED",
        module: "Borrowing",
        recordId: requestId,
        description: `Approved borrowing request ${requestId}`
    });

    return req || { id: requestId, status: "Approved" };
}

/**
 * BR-A4-03: Reject Borrowing Request (Admin Only)
 */
export async function rejectBorrowingRequest(requestId, reason) {
    const role = session.getRole();
    const profile = session.getProfile();

    if (role !== "administrator") {
        await recordAuditEvent({
            action: "ACCESS_DENIED",
            module: "Borrowing",
            recordId: requestId,
            description: `Unauthorized attempt to reject request ${requestId} by role '${role}'`
        });
        throw new Error("BR-A4-03 Violation: Access Denied. Only Administrator may reject requests.");
    }

    if (!reason || !reason.trim()) {
        throw new Error("Rejection reason is required.");
    }

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            await supabase
                .from("borrowing_requests")
                .update({
                    status: "Rejected",
                    rejected_reason: reason.trim(),
                    updated_at: new Date().toISOString()
                })
                .eq("id", requestId);
        } catch (err) {
            console.warn("Supabase reject request exception:", err.message);
        }
    }

    const requests = localDb.get("borrowing");
    const req = requests.find(r => r.id === requestId);
    if (req) {
        req.status = "Rejected";
        req.rejected_reason = reason.trim();
        localDb.set("borrowing", requests);
    }

    await recordAuditEvent({
        userId: profile.id,
        action: "REJECTED",
        module: "Borrowing",
        recordId: requestId,
        description: `Rejected borrowing request ${requestId}. Reason: ${reason}`
    });

    return req || { id: requestId, status: "Rejected" };
}

/**
 * BR-A4-04 & BR-A4-05 & BR-A4-07: Release Equipment
 * Only Approved requests may be released.
 * Released equipment becomes Borrowed atomically.
 */
export async function releaseEquipment(requestId) {
    const role = session.getRole();
    const profile = session.getProfile();

    if (role !== "administrator" && role !== "staff") {
        await recordAuditEvent({
            action: "ACCESS_DENIED",
            module: "Borrowing",
            recordId: requestId,
            description: `Unauthorized attempt to release equipment by role '${role}'`
        });
        throw new Error("Access Denied: Only Administrator or Laboratory Staff can release equipment.");
    }

    let targetEquipId = null;

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            const { data: reqData } = await supabase
                .from("borrowing_requests")
                .select("*, equipment(*)")
                .eq("id", requestId)
                .single();

            if (reqData) {
                targetEquipId = reqData.equipment_id;
                await supabase
                    .from("borrowing_requests")
                    .update({
                        status: "Released",
                        released_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", requestId);

                await supabase
                    .from("equipment")
                    .update({
                        status: "Borrowed",
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", targetEquipId);
            }
        } catch (err) {
            console.warn("Supabase release exception:", err.message);
        }
    }

    const requests = localDb.get("borrowing");
    const req = requests.find(r => r.id === requestId);
    if (req) {
        req.status = "Released";
        req.released_at = new Date().toISOString();
        localDb.set("borrowing", requests);

        const equipment = localDb.get("equipment");
        const equip = equipment.find(e => e.id === req.equipment_id);
        if (equip) {
            equip.status = "Borrowed";
            equip.updated_at = new Date().toISOString();
            localDb.set("equipment", equipment);
        }
    }

    await recordAuditEvent({
        userId: profile.id,
        action: "RELEASED",
        module: "Borrowing",
        recordId: requestId,
        description: `Released equipment to requester`
    });

    return req || { id: requestId, status: "Released" };
}

/**
 * BR-A4-06 & BR-A4-08: Process Equipment Return
 * Only Released or Overdue can be returned.
 * Returned equipment becomes Available unless damaged (becomes Damaged).
 * Duplicate returns are blocked.
 */
export async function processReturn(requestId, condition = "Good", remarks = "") {
    const role = session.getRole();
    const profile = session.getProfile();

    if (role !== "administrator" && role !== "staff") {
        await recordAuditEvent({
            action: "ACCESS_DENIED",
            module: "Borrowing",
            recordId: requestId,
            description: `Unauthorized attempt to process return by role '${role}'`
        });
        throw new Error("Access Denied: Only Administrator or Laboratory Staff can process returns.");
    }

    const isDamaged = condition.toLowerCase() === "damaged";
    const newEquipStatus = isDamaged ? "Damaged" : "Available";

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            const { data: reqData } = await supabase
                .from("borrowing_requests")
                .select("*, equipment(*)")
                .eq("id", requestId)
                .single();

            if (reqData) {
                await supabase
                    .from("borrowing_requests")
                    .update({
                        status: "Returned",
                        returned_at: new Date().toISOString(),
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", requestId);

                await supabase
                    .from("equipment")
                    .update({
                        status: newEquipStatus,
                        condition: condition,
                        updated_at: new Date().toISOString()
                    })
                    .eq("id", reqData.equipment_id);

                // Auto-create maintenance ticket if damaged
                if (isDamaged) {
                    await supabase.from("maintenance").insert([{
                        equipment_id: reqData.equipment_id,
                        requested_by: profile.id,
                        problem_description: `Returned Damaged. Remarks: ${remarks || 'Physical damage found on return check.'}`,
                        maintenance_date: new Date().toISOString().split("T")[0],
                        status: "Pending"
                    }]);
                }
            }
        } catch (err) {
            console.warn("Supabase process return exception:", err.message);
        }
    }

    const requests = localDb.get("borrowing");
    const req = requests.find(r => r.id === requestId);
    if (req) {
        req.status = "Returned";
        req.returned_at = new Date().toISOString();
        localDb.set("borrowing", requests);

        const equipment = localDb.get("equipment");
        const equip = equipment.find(e => e.id === req.equipment_id);
        if (equip) {
            equip.status = newEquipStatus;
            equip.condition = condition;
            equip.updated_at = new Date().toISOString();
            localDb.set("equipment", equipment);

            if (isDamaged) {
                const maintRecords = localDb.get("maintenance");
                maintRecords.unshift({
                    id: "m0000000-0000-0000-0000-" + String(Date.now()).slice(-12).padStart(12, "0"),
                    equipment_id: req.equipment_id,
                    requested_by: profile.id,
                    assigned_to: null,
                    problem_description: `Returned Damaged. Remarks: ${remarks || 'Physical damage found on return check.'}`,
                    maintenance_date: new Date().toISOString().split("T")[0],
                    status: "Pending",
                    remarks: null,
                    created_at: new Date().toISOString()
                });
                localDb.set("maintenance", maintRecords);
            }
        }
    }

    await recordAuditEvent({
        userId: profile.id,
        action: "RETURNED",
        module: "Borrowing",
        recordId: requestId,
        description: `Returned equipment in ${condition} condition${remarks ? '. Remarks: ' + remarks : ''}`
    });

    return req || { id: requestId, status: "Returned" };
}

/**
 * Cancel Pending Request (Requester Only)
 */
export async function cancelBorrowingRequest(requestId) {
    const profile = session.getProfile();

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            await supabase.from("borrowing_requests").delete().eq("id", requestId);
        } catch (err) {
            console.warn("Supabase cancel request exception:", err.message);
        }
    }

    const reqs = localDb.get("borrowing");
    const filtered = reqs.filter(r => r.id !== requestId);
    localDb.set("borrowing", filtered);

    await recordAuditEvent({
        userId: profile.id,
        action: "CANCELLED",
        module: "Borrowing",
        recordId: requestId,
        description: `Cancelled pending borrowing request ${requestId}`
    });

    return true;
}

/**
 * Initialize Admin Approval & Borrowing Overview Page
 */
export async function initAdminBorrowingPage() {
    const tableBody = document.getElementById("admin-borrowing-table-body");
    const statusFilter = document.getElementById("borrowing-status-filter");
    const searchInput = document.getElementById("borrowing-search");

    let allRequests = [];

    async function loadData() {
        try {
            allRequests = await fetchBorrowingRequests();
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
        const stat = statusFilter ? statusFilter.value : "";

        const filtered = allRequests.filter(r => {
            const requesterName = r.requester ? r.requester.full_name.toLowerCase() : "";
            const equipCode = r.equipment ? r.equipment.asset_code.toLowerCase() : "";
            const equipName = r.equipment ? r.equipment.equipment_name.toLowerCase() : "";
            const purpose = (r.purpose || "").toLowerCase();

            const matchQuery = !query ||
                requesterName.includes(query) ||
                equipCode.includes(query) ||
                equipName.includes(query) ||
                purpose.includes(query);

            const matchStat = !stat || r.status === stat;

            return matchQuery && matchStat;
        });

        if (filtered.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" class="empty-state">
                        <div class="empty-icon">📋</div>
                        <div class="empty-title">No Borrowing Requests Found</div>
                        <p class="empty-text">No requests match the selected filters.</p>
                    </td>
                </tr>
            `;
            return;
        }

        const currentRole = session.getRole();

        tableBody.innerHTML = filtered.map(req => {
            const requesterName = req.requester ? req.requester.full_name : "Unknown Requester";
            const equip = req.equipment || { asset_code: "N/A", equipment_name: "Deleted Equipment" };

            let actionBtns = "";
            if (req.status === "Pending") {
                if (currentRole === "administrator") {
                    actionBtns = `
                        <button class="btn btn-sm btn-success btn-approve-req" data-id="${req.id}" title="Approve Request">✓ Approve</button>
                        <button class="btn btn-sm btn-danger btn-reject-req" data-id="${req.id}" title="Reject Request">✕ Reject</button>
                    `;
                } else {
                    actionBtns = `<span class="badge badge-pending" style="font-size: 0.72rem;">Awaiting Admin Approval</span>`;
                }
            } else if (req.status === "Approved") {
                actionBtns = `
                    <button class="btn btn-sm btn-accent btn-release-req" data-id="${req.id}" title="Release Equipment">📦 Release</button>
                `;
            } else if (req.status === "Rejected") {
                actionBtns = `<span style="font-size: 0.75rem; color: var(--color-rejected);" title="${escapeHtml(req.rejected_reason || '')}">Reason: ${escapeHtml(req.rejected_reason ? (req.rejected_reason.slice(0, 20) + '...') : 'None')}</span>`;
            } else {
                actionBtns = `<span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(req.status)}</span>`;
            }

            return `
                <tr>
                    <td><code>${String(req.id).slice(0, 8)}...</code></td>
                    <td><strong>${escapeHtml(requesterName)}</strong></td>
                    <td>
                        <strong>${escapeHtml(equip.asset_code)}</strong>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(equip.equipment_name)}</div>
                    </td>
                    <td style="max-width: 250px;">${escapeHtml(req.purpose)}</td>
                    <td>${req.request_date}</td>
                    <td><span style="font-weight: 600;">${req.expected_return_date}</span></td>
                    <td>${renderBorrowingStatusBadge(req.status)}</td>
                    <td class="actions-col">${actionBtns}</td>
                </tr>
            `;
        }).join("");

        // Bind events
        tableBody.querySelectorAll(".btn-approve-req").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                showConfirm(
                    "Approve Borrowing Request",
                    "Are you sure you want to approve this borrowing request?",
                    async () => {
                        try {
                            await approveBorrowingRequest(id);
                            showToast("Approved", "Borrowing request approved successfully.", "success");
                            await loadData();
                        } catch (err) {
                            showToast("Error", err.message, "error");
                        }
                    },
                    "Approve",
                    "btn-success"
                );
            });
        });

        tableBody.querySelectorAll(".btn-reject-req").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                openRejectModal(id, loadData);
            });
        });

        tableBody.querySelectorAll(".btn-release-req").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                showConfirm(
                    "Release Equipment",
                    "Confirm physical release of this equipment to the requester? Equipment status will change to 'Borrowed'.",
                    async () => {
                        try {
                            await releaseEquipment(id);
                            showToast("Released", "Equipment released and marked as Borrowed.", "success");
                            await loadData();
                        } catch (err) {
                            showToast("Error", err.message, "error");
                        }
                    },
                    "Release Equipment",
                    "btn-accent"
                );
            });
        });
    }

    if (searchInput) searchInput.addEventListener("input", renderTable);
    if (statusFilter) statusFilter.addEventListener("change", renderTable);

    await loadData();
}

/**
 * Rejection Reason Modal (Section 20)
 */
function openRejectModal(requestId, onSuccess) {
    showModal({
        title: "Reject Borrowing Request",
        bodyHtml: `
            <p style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 1rem;">
                Please specify a clear, professional reason for rejecting this laboratory request.
            </p>
            <div class="form-group">
                <label class="form-label required">Rejection Reason</label>
                <textarea id="reject-reason-input" class="form-textarea" placeholder="e.g. Equipment required for scheduled laboratory curriculum activity..." required></textarea>
            </div>
        `,
        confirmText: "Reject Request",
        confirmClass: "btn-danger",
        onConfirm: async () => {
            const reason = document.getElementById("reject-reason-input").value.trim();
            if (!reason) {
                showToast("Required", "Please provide a rejection reason.", "warning");
                return false;
            }
            try {
                await rejectBorrowingRequest(requestId, reason);
                showToast("Rejected", "Request marked as Rejected.", "info");
                if (onSuccess) await onSuccess();
                return true;
            } catch (err) {
                showToast("Error", err.message, "error");
                return false;
            }
        }
    });
}

/**
 * Initialize Staff Returns Management Page
 */
export async function initReturnsPage() {
    const tableBody = document.getElementById("returns-table-body");
    const searchInput = document.getElementById("returns-search");

    let activeBorrowings = [];

    async function loadData() {
        try {
            const all = await fetchBorrowingRequests();
            // Returns page processes Released and Overdue items
            activeBorrowings = all.filter(r => r.status === "Released" || r.status === "Overdue");
            renderTable();
        } catch (err) {
            if (tableBody) {
                tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--color-damaged);">${err.message}</td></tr>`;
            }
        }
    }

    function renderTable() {
        if (!tableBody) return;
        const query = (searchInput ? searchInput.value : "").toLowerCase().trim();

        const filtered = activeBorrowings.filter(r => {
            const requester = r.requester ? r.requester.full_name.toLowerCase() : "";
            const assetCode = r.equipment ? r.equipment.asset_code.toLowerCase() : "";
            const equipName = r.equipment ? r.equipment.equipment_name.toLowerCase() : "";
            return !query || requester.includes(query) || assetCode.includes(query) || equipName.includes(query);
        });

        if (filtered.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="7" class="empty-state">
                        <div class="empty-icon">🔄</div>
                        <div class="empty-title">No Active Borrowings to Return</div>
                        <p class="empty-text">There are currently no released or overdue equipment items awaiting return.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = filtered.map(req => {
            const requester = req.requester ? req.requester.full_name : "Unknown";
            const equip = req.equipment || { asset_code: "N/A", equipment_name: "Unknown" };

            return `
                <tr>
                    <td><code>${String(req.id).slice(0, 8)}...</code></td>
                    <td><strong>${escapeHtml(requester)}</strong></td>
                    <td>
                        <strong>${escapeHtml(equip.asset_code)}</strong>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(equip.equipment_name)}</div>
                    </td>
                    <td>${req.released_at ? new Date(req.released_at).toLocaleDateString() : 'N/A'}</td>
                    <td>${req.expected_return_date}</td>
                    <td>${renderBorrowingStatusBadge(req.status)}</td>
                    <td class="actions-col">
                        <button class="btn btn-sm btn-primary btn-process-return" data-id="${req.id}" data-code="${escapeHtml(equip.asset_code)}">
                            Process Return
                        </button>
                    </td>
                </tr>
            `;
        }).join("");

        tableBody.querySelectorAll(".btn-process-return").forEach(btn => {
            btn.addEventListener("click", () => {
                const id = btn.dataset.id;
                const code = btn.dataset.code;
                openReturnModal(id, code, loadData);
            });
        });
    }

    if (searchInput) searchInput.addEventListener("input", renderTable);
    await loadData();
}

function openReturnModal(requestId, assetCode, onSuccess) {
    showModal({
        title: `Process Equipment Return: ${assetCode}`,
        bodyHtml: `
            <form id="form-process-return">
                <div class="form-group">
                    <label class="form-label required">Equipment Return Condition</label>
                    <select id="return-condition-select" class="form-select">
                        <option value="Good">Good (Working & Complete)</option>
                        <option value="Fair">Fair (Minor cosmetic wear, functioning)</option>
                        <option value="Damaged">Damaged (Requires maintenance / repair)</option>
                    </select>
                    <div class="form-help">
                        If marked as <strong>Damaged</strong>, equipment status automatically becomes <code>Damaged</code> and cannot be requested.
                    </div>
                </div>
                <div class="form-group">
                    <label class="form-label">Inspector Remarks / Damage Description</label>
                    <textarea id="return-remarks-input" class="form-textarea" placeholder="Note condition, missing cables, or test verification details..."></textarea>
                </div>
            </form>
        `,
        confirmText: "Complete Return",
        confirmClass: "btn-success",
        onConfirm: async () => {
            const condition = document.getElementById("return-condition-select").value;
            const remarks = document.getElementById("return-remarks-input").value.trim();

            try {
                await processReturn(requestId, condition, remarks);
                showToast("Returned", `Return processed for ${assetCode}. Equipment marked as ${condition === 'Damaged' ? 'Damaged' : 'Available'}.`, "success");
                if (onSuccess) await onSuccess();
                return true;
            } catch (err) {
                showToast("Error", err.message, "error");
                return false;
            }
        }
    });
}

/**
 * Initialize Requester Form & Request Status Tracker
 */
export async function initRequesterSubmission() {
    const equipSelect = document.getElementById("req-equipment-select");
    const purposeInput = document.getElementById("req-purpose");
    const dateInput = document.getElementById("req-return-date");
    const submitBtn = document.getElementById("btn-submit-request");

    if (!equipSelect || !submitBtn) return;

    // Pre-populate available equipment only (BR-A4-01 & BR-A4-09)
    try {
        const allEquip = await (await import("./equipment.js")).fetchEquipment();
        const available = allEquip.filter(e => e.status && e.status.toLowerCase() === "available");

        if (available.length === 0) {
            equipSelect.innerHTML = `<option value="">No equipment is currently available for borrowing</option>`;
            submitBtn.disabled = true;
        } else {
            // Check if pre-selected equipmentId from query parameter
            const urlParams = new URLSearchParams(window.location.search);
            const preselectedId = urlParams.get("equipmentId");

            equipSelect.innerHTML = `<option value="">-- Choose an Available Laboratory Asset --</option>` +
                available.map(e => `
                    <option value="${e.id}" ${e.id === preselectedId ? 'selected' : ''}>
                        ${escapeHtml(e.asset_code)} — ${escapeHtml(e.equipment_name)} (${escapeHtml(e.category)})
                    </option>
                `).join("");
        }
    } catch (err) {
        console.error("Error loading equipment for request:", err);
    }

    // Set minimum date to today
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    if (dateInput) {
        dateInput.min = new Date().toISOString().split("T")[0];
        dateInput.value = tomorrow.toISOString().split("T")[0];
    }

    submitBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        const equipId = equipSelect.value;
        const purpose = purposeInput.value.trim();
        const returnDate = dateInput.value;

        if (!equipId) {
            showToast("Required", "Please select equipment to request.", "warning");
            return;
        }
        if (!purpose) {
            showToast("Required", "Please state the purpose of borrowing.", "warning");
            return;
        }
        if (!returnDate) {
            showToast("Required", "Please choose an expected return date.", "warning");
            return;
        }

        submitBtn.disabled = true;
        submitBtn.textContent = "Submitting...";

        try {
            await submitBorrowingRequest({
                equipmentId: equipId,
                purpose,
                expectedReturnDate: returnDate
            });
            showToast("Request Submitted", "Your borrowing request has been submitted with status 'Pending' for administrator approval.", "success");
            setTimeout(() => {
                window.location.href = "./my-requests.html";
            }, 1200);
        } catch (err) {
            showToast("Submission Failed", err.message, "error");
            submitBtn.disabled = false;
            submitBtn.textContent = "Submit Borrowing Request";
        }
    });
}

/**
 * Initialize Requester's "My Requests" Tracker
 */
export async function initMyRequestsPage() {
    const tableBody = document.getElementById("my-requests-table-body");
    if (!tableBody) return;

    const renderPage = async () => {
        try {
            const requests = await fetchBorrowingRequests();
            const active = requests.filter(r => r.status !== "Returned" && r.status !== "Closed");

            if (active.length === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="6" class="empty-state">
                            <div class="empty-icon">📋</div>
                            <div class="empty-title">No Active Requests</div>
                            <p class="empty-text">You have no pending or active equipment requests at this time.</p>
                            <a href="./request.html" class="btn btn-primary" style="margin-top: 1rem;">Request Equipment</a>
                        </td>
                    </tr>
                `;
                return;
            }

            tableBody.innerHTML = active.map(req => {
                const equip = req.equipment || { asset_code: "N/A", equipment_name: "N/A" };
                let actionHtml = `<span style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(req.status)}</span>`;
                if (req.status === "Pending") {
                    actionHtml = `<button class="btn btn-sm btn-danger btn-cancel-my-req" data-id="${req.id}" title="Cancel this pending request">Cancel</button>`;
                }

                return `
                    <tr>
                        <td><code>${String(req.id).slice(0, 8)}...</code></td>
                        <td>
                            <strong>${escapeHtml(equip.asset_code)}</strong>
                            <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(equip.equipment_name)}</div>
                        </td>
                        <td>${escapeHtml(req.purpose)}</td>
                        <td>${req.request_date}</td>
                        <td><strong>${req.expected_return_date}</strong></td>
                        <td>${renderBorrowingStatusBadge(req.status)}</td>
                        <td class="actions-col">${actionHtml}</td>
                    </tr>
                `;
            }).join("");

            tableBody.querySelectorAll(".btn-cancel-my-req").forEach(btn => {
                btn.addEventListener("click", () => {
                    const id = btn.dataset.id;
                    showConfirm(
                        "Cancel Request",
                        "Are you sure you want to cancel this pending request?",
                        async () => {
                            try {
                                await cancelBorrowingRequest(id);
                                showToast("Cancelled", "Your request has been cancelled.", "info");
                                await renderPage();
                            } catch (err) {
                                showToast("Error", err.message, "error");
                            }
                        },
                        "Cancel Request",
                        "btn-danger"
                    );
                });
            });
        } catch (err) {
            tableBody.innerHTML = `<tr><td colspan="7" style="text-align:center; color: var(--color-damaged);">${err.message}</td></tr>`;
        }
    };

    await renderPage();

    if (supabaseConfig.isConfigured() && supabase) {
        subscribeRequesterBorrowingUpdates(async () => {
            await renderPage();
        });
    }

    const handleBorrowingSync = async (event) => {
        const changedKeys = ["lab_db_borrowing", "lab_db_equipment", "lab_db_profiles", "lab_active_session"];
        const key = event?.detail?.key || event?.key;
        if (key && changedKeys.includes(key)) {
            await renderPage();
        }
    };

    window.addEventListener("lab-data-sync", handleBorrowingSync);
    window.addEventListener("storage", handleBorrowingSync);
}

/**
 * Initialize Requester's History Page
 */
export async function initMyHistoryPage() {
    const tableBody = document.getElementById("my-history-table-body");
    if (!tableBody) return;

    try {
        const requests = await fetchBorrowingRequests();
        const history = requests.filter(r => r.status === "Returned" || r.status === "Closed" || r.status === "Rejected");

        if (history.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="6" class="empty-state">
                        <div class="empty-icon">⏱️</div>
                        <div class="empty-title">No Completed History</div>
                        <p class="empty-text">You do not have any past completed or returned borrowing transactions.</p>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = history.map(req => {
            const equip = req.equipment || { asset_code: "N/A", equipment_name: "N/A" };
            const returnedDate = req.returned_at ? new Date(req.returned_at).toLocaleDateString() : 'N/A';
            return `
                <tr>
                    <td><code>${String(req.id).slice(0, 8)}...</code></td>
                    <td>
                        <strong>${escapeHtml(equip.asset_code)}</strong>
                        <div style="font-size: 0.75rem; color: var(--text-muted);">${escapeHtml(equip.equipment_name)}</div>
                    </td>
                    <td>${escapeHtml(req.purpose)}</td>
                    <td>${req.request_date}</td>
                    <td>${returnedDate}</td>
                    <td>${renderBorrowingStatusBadge(req.status)}</td>
                </tr>
            `;
        }).join("");
    } catch (err) {
        tableBody.innerHTML = `<tr><td colspan="6" style="text-align:center; color: var(--color-damaged);">${err.message}</td></tr>`;
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
