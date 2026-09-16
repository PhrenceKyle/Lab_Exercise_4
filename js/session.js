/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * Session Management & Current User Profile Store
 * =====================================================================
 */

import { supabase, supabaseConfig, localDb } from "./supabase.js?v=2.6";

const SESSION_STORAGE_KEY = "lab_active_session";

export const session = {
    /**
     * Get active session object { user, profile, role, token }
     */
    getSession() {
        const raw = localStorage.getItem(SESSION_STORAGE_KEY);
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    },

    /**
     * Save active session
     */
    setSession(sessionData) {
        localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessionData));
    },

    /**
     * Destroy current session
     */
    clearSession() {
        localStorage.removeItem(SESSION_STORAGE_KEY);
    },

    /**
     * Get current authenticated user profile
     */
    getProfile() {
        const s = this.getSession();
        return s ? s.profile : null;
    },

    /**
     * Get role string: 'administrator' | 'staff' | 'requester'
     */
    getRole() {
        const s = this.getSession();
        return s && s.profile ? s.profile.role : null;
    },

    /**
     * Check if user is logged in and active
     */
    isAuthenticated() {
        const p = this.getProfile();
        return !!p && p.status === "active";
    },

    async restoreFromSupabase() {
        if (!supabaseConfig.isConfigured() || !supabase) {
            this.clearSession();
            return null;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error || !data?.session?.user) {
            this.clearSession();
            return null;
        }

        const user = data.session.user;
        const { data: profile, error: profileError } = await supabase
            .from("profiles")
            .select("*")
            .eq("id", user.id)
            .single();

        if (profileError || !profile || profile.status !== "active") {
            this.clearSession();
            return null;
        }

        this.setSession({
            user,
            profile,
            role: profile.role,
            token: data.session.access_token
        });

        return data.session;
    },

    /**
     * Refresh profile from database
     */
    async refreshProfile() {
        const s = this.getSession();
        if (!s || !s.profile) return null;

        if (supabaseConfig.isConfigured() && supabase) {
            try {
                const { data, error } = await supabase
                    .from("profiles")
                    .select("*")
                    .eq("id", s.profile.id)
                    .single();
                if (!error && data) {
                    s.profile = data;
                    this.setSession(s);
                    return data;
                }
            } catch (err) {
                console.error("Failed to refresh Supabase profile:", err);
            }
        }

        // Local storage fallback
        const profiles = localDb.get("profiles");
        const found = profiles.find(p => p.id === s.profile.id);
        if (found) {
            s.profile = found;
            this.setSession(s);
            return found;
        }

        return s.profile;
    }
};
