/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * UI Utilities: Notifications, Dialogs, Badges & Dynamic Navigation
 * =====================================================================
 */

import { session } from "./session.js?v=2.6";
import { logout } from "./auth.js?v=2.6";
import { supabaseConfig, saveSupabaseConfig, clearSupabaseConfig } from "./supabase.js?v=2.6";

/**
 * Toast Notification System
 */
export function showToast(title, message, type = "info") {
    let container = document.getElementById("toast-container");
    if (!container) {
        container = document.createElement("div");
        container.id = "toast-container";
        container.className = "toast-container";
        document.body.appendChild(container);
    }

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <div class="toast-content">
            <h5>${escapeHtml(title)}</h5>
            <p>${escapeHtml(message)}</p>
        </div>
        <button class="toast-close" aria-label="Close">&times;</button>
    `;

    toast.querySelector(".toast-close").addEventListener("click", () => {
        toast.remove();
    });

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = "0";
        toast.style.transform = "translateX(100px)";
        setTimeout(() => toast.remove(), 300);
    }, 4500);
}

/**
 * Accessible Modal System
 */
export function showModal({ title, bodyHtml, confirmText = "Confirm", confirmClass = "btn-primary", onConfirm, showCancel = true }) {
    let backdrop = document.getElementById("app-modal-backdrop");
    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "app-modal-backdrop";
        backdrop.className = "modal-backdrop";
        backdrop.innerHTML = `
            <div class="modal-dialog" role="dialog" aria-modal="true">
                <div class="modal-header">
                    <h3 class="modal-title" id="app-modal-title"></h3>
                    <button class="modal-close" id="app-modal-close">&times;</button>
                </div>
                <div class="modal-body" id="app-modal-body"></div>
                <div class="modal-footer" id="app-modal-footer"></div>
            </div>
        `;
        document.body.appendChild(backdrop);

        backdrop.querySelector("#app-modal-close").addEventListener("click", closeModal);
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) closeModal();
        });
    }

    document.getElementById("app-modal-title").textContent = title;
    document.getElementById("app-modal-body").innerHTML = bodyHtml;

    const footer = document.getElementById("app-modal-footer");
    footer.innerHTML = "";

    if (showCancel) {
        const cancelBtn = document.createElement("button");
        cancelBtn.className = "btn btn-secondary";
        cancelBtn.textContent = "Cancel";
        cancelBtn.addEventListener("click", closeModal);
        footer.appendChild(cancelBtn);
    }

    if (confirmText) {
        const confirmBtn = document.createElement("button");
        confirmBtn.className = `btn ${confirmClass}`;
        confirmBtn.textContent = confirmText;
        confirmBtn.addEventListener("click", async () => {
            if (onConfirm) {
                const res = await onConfirm();
                if (res !== false) closeModal();
            } else {
                closeModal();
            }
        });
        footer.appendChild(confirmBtn);
    }

    backdrop.classList.add("active");
}

export function closeModal() {
    const backdrop = document.getElementById("app-modal-backdrop");
    if (backdrop) backdrop.classList.remove("active");
}

/**
 * Confirmation Dialog Helper (Section 33)
 */
export function showConfirm(title, message, onConfirm, confirmText = "Confirm", confirmClass = "btn-primary") {
    showModal({
        title,
        bodyHtml: `<p style="font-size: 0.95rem; color: var(--primary-700); margin: 0;">${escapeHtml(message)}</p>`,
        confirmText,
        confirmClass,
        onConfirm
    });
}

/**
 * Status Badge Renderers
 */
export function renderEquipmentStatusBadge(status) {
    const s = (status || "Available").toLowerCase();
    return `<span class="badge badge-${s}">${escapeHtml(status)}</span>`;
}

export function renderBorrowingStatusBadge(status) {
    const s = (status || "Pending").toLowerCase();
    return `<span class="badge badge-${s}">${escapeHtml(status)}</span>`;
}

export function renderRoleBadge(role) {
    const r = (role || "requester").toLowerCase();
    return `<span class="role-badge role-${r}">${escapeHtml(role)}</span>`;
}

/**
 * Dynamic Sidebar Navigation Generator based on authenticated Role (Section 26)
 */
export function renderSidebar(currentActiveKey = "") {
    const sidebarEl = document.getElementById("app-sidebar");
    if (!sidebarEl) return;

    const profile = session.getProfile();
    const role = profile ? profile.role : "requester";
    const isUnderPages = window.location.pathname.includes("/pages/");
    const pathToRoot = isUnderPages ? "../../" : "./";

    // Navigation links tailored per role
    let navItems = [];

    if (role === "administrator") {
        navItems = [
            { key: "dashboard", label: "Dashboard", icon: "📊", href: `${pathToRoot}dashboard.html` },
            { key: "users", label: "Users & Roles", icon: "👥", href: `${pathToRoot}pages/admin/users.html` },
            { key: "equipment", label: "Equipment Management", icon: "💻", href: `${pathToRoot}pages/admin/equipment.html` },
            { key: "borrowing", label: "Borrowing Requests", icon: "📋", href: `${pathToRoot}pages/admin/borrowing.html` },
            { key: "maintenance", label: "Maintenance", icon: "🔧", href: `${pathToRoot}pages/admin/maintenance.html` },
            { key: "reports", label: "Reports", icon: "📈", href: `${pathToRoot}pages/admin/reports.html` },
            { key: "audit", label: "Audit Logs", icon: "📜", href: `${pathToRoot}pages/admin/audit-logs.html` }
        ];
    } else if (role === "staff") {
        navItems = [
            { key: "dashboard", label: "Dashboard", icon: "📊", href: `${pathToRoot}dashboard.html` },
            { key: "equipment", label: "Equipment Catalog", icon: "💻", href: `${pathToRoot}pages/staff/equipment.html` },
            { key: "borrowing", label: "Borrowing Operations", icon: "📋", href: `${pathToRoot}pages/staff/borrowing.html` },
            { key: "returns", label: "Process Returns", icon: "🔄", href: `${pathToRoot}pages/staff/returns.html` },
            { key: "maintenance", label: "Maintenance Tickets", icon: "🔧", href: `${pathToRoot}pages/staff/maintenance.html` }
        ];
    } else {
        // requester
        navItems = [
            { key: "dashboard", label: "Dashboard", icon: "📊", href: `${pathToRoot}dashboard.html` },
            { key: "equipment", label: "Available Equipment", icon: "💻", href: `${pathToRoot}pages/requester/equipment.html` },
            { key: "request", label: "Request Equipment", icon: "➕", href: `${pathToRoot}pages/requester/request.html` },
            { key: "my-requests", label: "My Requests", icon: "📋", href: `${pathToRoot}pages/requester/my-requests.html` },
            { key: "history", label: "Borrowing History", icon: "⏱️", href: `${pathToRoot}pages/requester/history.html` }
        ];
    }

    const navHtml = navItems.map(item => `
        <a href="${item.href}" class="nav-link ${item.key === currentActiveKey ? 'active' : ''}">
            <span class="icon">${item.icon}</span>
            <span>${escapeHtml(item.label)}</span>
        </a>
    `).join("");

    const initial = profile && profile.full_name ? profile.full_name.charAt(0).toUpperCase() : "U";

    sidebarEl.innerHTML = `
        <div class="sidebar-header">
            <div class="brand-icon">🔬</div>
            <div class="brand-info">
                <h3>LabAsset Pro</h3>
                <span>Systems & Design Lab 4</span>
            </div>
        </div>

        <div class="sidebar-user-pill">
            <span style="font-size: 0.8rem; color: #cbd5e1;">Logged in as:</span>
            ${renderRoleBadge(role)}
        </div>

        <nav class="sidebar-nav">
            <div class="nav-section-title">Navigation Menu</div>
            ${navHtml}
        </nav>

        <div class="sidebar-footer">
            <div class="user-snippet">
                <div class="user-avatar">${initial}</div>
                <div class="user-meta">
                    <div class="user-meta-name">${escapeHtml(profile ? profile.full_name : "User")}</div>
                    <div class="user-meta-email">${escapeHtml(profile ? profile.email : "")}</div>
                </div>
            </div>
            <button id="btn-sidebar-logout" class="btn-logout" title="Sign Out">
                🚪
            </button>
        </div>
    `;

    // Bind logout button
    const logoutBtn = sidebarEl.querySelector("#btn-sidebar-logout");
    if (logoutBtn) {
        logoutBtn.addEventListener("click", () => {
            showConfirm("Sign Out", "Are you sure you want to end your active session?", () => {
                logout();
            }, "Sign Out", "btn-danger");
        });
    }
}

/**
 * Header bar initialization with Supabase status pill
 */
export function initHeaderBar(breadcrumbTitle = "Dashboard") {
    const headerTitleEl = document.getElementById("header-breadcrumb-current");
    if (headerTitleEl) {
        headerTitleEl.textContent = breadcrumbTitle;
    }

    // Supabase Connection indicator
    const connEl = document.getElementById("header-conn-status");
    if (connEl) {
        const isLive = supabaseConfig.isConfigured();
        connEl.innerHTML = `
            <button id="btn-config-supabase" class="btn btn-sm btn-secondary" style="font-size: 0.75rem; padding: 0.25rem 0.65rem; border-radius: 9999px; display: inline-flex; align-items: center; gap: 0.35rem;" title="Click to view or update Supabase connection settings">
                <span style="display:inline-block; width: 8px; height: 8px; border-radius: 50%; background: ${isLive ? '#10b981' : '#f59e0b'};"></span>
                <span>${isLive ? 'Supabase: Connected' : '⚡ Connect Supabase'}</span>
            </button>
        `;

        const configBtn = document.getElementById("btn-config-supabase");
        if (configBtn) {
            configBtn.addEventListener("click", openSupabaseConfigModal);
        }
    }
}

/**
 * Interactive Supabase Connection Configuration Modal
 */
export function openSupabaseConfigModal() {
    const currentUrl = localStorage.getItem("lab_supabase_url") || supabaseConfig.url || "";
    const currentKey = localStorage.getItem("lab_supabase_anon_key") || supabaseConfig.anonKey || "";

    showModal({
        title: "Supabase Connection Settings",
        bodyHtml: `
            <p style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 1rem;">
                Connect this application directly to your live Supabase database and authentication.
                Only provide your <strong>Public Anon Key</strong>. Never enter your Service Role key.
            </p>
            <div class="form-group">
                <label class="form-label required">Supabase Project URL</label>
                <input type="text" id="cfg-supabase-url" class="form-control" placeholder="https://your-project.supabase.co" value="${escapeHtml(currentUrl)}">
            </div>
            <div class="form-group">
                <label class="form-label required">Supabase Anon Public Key</label>
                <input type="password" id="cfg-supabase-key" class="form-control" placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6..." value="${escapeHtml(currentKey)}">
            </div>
            <div style="font-size: 0.75rem; color: var(--text-light); margin-top: 0.5rem;">
                Tables and RLS policies must be created using the provided <code>database/schema.sql</code> and <code>database/rls-policies.sql</code> scripts.
            </div>
        `,
        confirmText: "Save & Connect",
        confirmClass: "btn-primary",
        onConfirm: () => {
            const url = document.getElementById("cfg-supabase-url").value.trim();
            const key = document.getElementById("cfg-supabase-key").value.trim();
            if (!url || !key) {
                showToast("Configuration Error", "Please provide both Project URL and Anon Key.", "error");
                return false;
            }
            saveSupabaseConfig(url, key);
            return true;
        }
    });
}

/**
 * Mobile Menu Toggle Setup
 */
export function initMobileMenu() {
    const toggleBtn = document.getElementById("btn-mobile-menu");
    const sidebar = document.getElementById("app-sidebar");
    let overlay = document.getElementById("mobile-menu-overlay");

    if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "mobile-menu-overlay";
        overlay.className = "mobile-overlay";
        document.body.appendChild(overlay);
    }

    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener("click", () => {
            sidebar.classList.toggle("open");
            overlay.classList.toggle("active");
        });

        overlay.addEventListener("click", () => {
            sidebar.classList.remove("open");
            overlay.classList.remove("active");
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
