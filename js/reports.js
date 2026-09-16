/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * Reporting Engine: Equipment Utilization, Overdue Analytics & Printouts
 * =====================================================================
 */

import { fetchEquipment } from "./equipment.js";
import { fetchBorrowingRequests } from "./borrowing.js";
import { fetchMaintenanceRecords } from "./maintenance.js";
import { fetchUsers } from "./users.js";
import { session } from "./session.js";

export async function initReportsPage() {
    const role = session.getRole();
    if (role === "requester") {
        throw new Error("Access Denied: Requesters are not authorized to view reports.");
    }

    try {
        const [equipment, borrowings, maintenance] = await Promise.all([
            fetchEquipment(),
            fetchBorrowingRequests(),
            fetchMaintenanceRecords()
        ]);

        let users = [];
        if (role === "administrator") {
            try { users = await fetchUsers(); } catch (e) { /* ignore */ }
        }

        renderMetrics(equipment, borrowings, maintenance, users);
        renderCategoryBreakdown(equipment);
        renderRecentTransactionsSummary(borrowings);

        const printBtn = document.getElementById("btn-print-report");
        if (printBtn) {
            printBtn.addEventListener("click", () => window.print());
        }
    } catch (err) {
        console.error("Reports loading error:", err);
    }
}

function renderMetrics(equipment, borrowings, maintenance, users) {
    const totalEquip = equipment.length;
    const available = equipment.filter(e => e.status === "Available").length;
    const borrowed = equipment.filter(e => e.status === "Borrowed").length;
    const inMaint = equipment.filter(e => e.status === "Maintenance").length;
    const overdue = borrowings.filter(b => b.status === "Overdue").length;

    const utilRate = totalEquip > 0 ? Math.round((borrowed / totalEquip) * 100) : 0;
    const availRate = totalEquip > 0 ? Math.round((available / totalEquip) * 100) : 0;

    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = val;
    };

    setVal("rep-total-equip", totalEquip);
    setVal("rep-util-rate", `${utilRate}%`);
    setVal("rep-avail-rate", `${availRate}%`);
    setVal("rep-overdue-count", overdue);
    setVal("rep-maint-count", inMaint);
    if (users && users.length) setVal("rep-total-users", users.length);
}

function renderCategoryBreakdown(equipment) {
    const container = document.getElementById("category-breakdown-body");
    if (!container) return;

    const catCounts = {};
    equipment.forEach(e => {
        catCounts[e.category] = (catCounts[e.category] || 0) + 1;
    });

    const rows = Object.entries(catCounts).map(([cat, count]) => {
        const pct = Math.round((count / equipment.length) * 100);
        return `
            <div style="margin-bottom: 0.85rem;">
                <div style="display: flex; justify-content: space-between; font-size: 0.85rem; margin-bottom: 0.25rem;">
                    <strong>${cat}</strong>
                    <span>${count} units (${pct}%)</span>
                </div>
                <div style="height: 8px; background: var(--border-color); border-radius: 4px; overflow: hidden;">
                    <div style="width: ${pct}%; height: 100%; background: var(--brand-blue);"></div>
                </div>
            </div>
        `;
    }).join("");

    container.innerHTML = rows;
}

function renderRecentTransactionsSummary(borrowings) {
    const container = document.getElementById("reports-recent-summary");
    if (!container) return;

    const recent = borrowings.slice(0, 5);
    container.innerHTML = recent.map(b => `
        <tr>
            <td><strong>${b.equipment ? b.equipment.asset_code : 'N/A'}</strong></td>
            <td>${b.requester ? b.requester.full_name : 'Requester'}</td>
            <td>${b.request_date}</td>
            <td>${b.expected_return_date}</td>
            <td><span class="badge badge-${b.status.toLowerCase()}">${b.status}</span></td>
        </tr>
    `).join("");
}
