/**
 * =====================================================================
 * LABORATORY ASSET AND SERVICE MANAGEMENT SYSTEM
 * Laboratory 4, Section A: Role-Based Asset Transaction and Approval Management
 * Authentication Module: Login, Logout, Session Initiation & Demo Quick-Fill
 * =====================================================================
 */

import { supabase, supabaseConfig, localDb } from "./supabase.js?v=2.6";
import { session } from "./session.js?v=2.6";
import { recordAuditEvent } from "./audit.js?v=2.6";

/**
 * Perform Login
 */
export async function login(email, password) {
    email = email.trim().toLowerCase();

    if (!supabaseConfig.isConfigured() || !supabase) {
        throw new Error("Supabase is not configured. Authentication is unavailable.");
    }

    try {
            const { data, error } = await supabase.auth.signInWithPassword({
                email,
                password
            });
            if (error || !data?.session?.user) {
                throw new Error(error?.message || "Supabase did not return an authenticated session.");
            }

            if (data.session.user) {
                // Ensure profile exists in public.profiles with correct role
                let { data: profile, error: profileError } = await supabase
                    .from("profiles")
                    .select("*")
                    .eq("id", data.user.id)
                    .single();

                if (profileError && profileError.code !== "PGRST116") {
                    throw new Error(`Unable to load your Supabase profile: ${profileError.message}`);
                }

                if (!profile) {
                    const intendedRole = data.user.user_metadata?.role ||
                        (email.includes("admin") ? "administrator" : (email.includes("staff") ? "staff" : "requester"));
                    const fullName = data.user.user_metadata?.full_name || email.split("@")[0];

                    const { data: newProf, error: profileInsertError } = await supabase
                        .from("profiles")
                        .upsert({
                            id: data.user.id,
                            email: email,
                            full_name: fullName,
                            role: intendedRole,
                            status: "active"
                        })
                        .select()
                        .single();

                    if (profileInsertError || !newProf) {
                        throw new Error(`Unable to create your Supabase profile: ${profileInsertError?.message || "no profile returned"}`);
                    }
                    profile = newProf;
                }

                if (profile && profile.status === "active") {
                    session.setSession({
                        user: data.user,
                        profile,
                        role: profile.role,
                        token: data.session ? data.session.access_token : "live_token"
                    });

                    // Keep localDb in sync for offline cache
                    const profiles = localDb.get("profiles") || [];
                    const idx = profiles.findIndex(p => p.id === profile.id || p.email.toLowerCase() === profile.email.toLowerCase());
                    if (idx >= 0) {
                        profiles[idx] = profile;
                    } else {
                        profiles.push(profile);
                    }
                    localDb.set("profiles", profiles);

                    await recordAuditEvent({
                        userId: profile.id,
                        action: "LOGIN",
                        module: "Auth",
                        recordId: profile.id,
                        description: `${profile.full_name} logged into the system (Supabase Live Auth)`
                    });

                    return { success: true, profile };
                }
            }
        } catch (err) {
            throw new Error(`Supabase sign-in failed: ${err.message}`);
        }
}

/**
 * Register a new user account
 */
export async function registerUser({ fullName, email, password, role }) {
    email = email.trim().toLowerCase();
    fullName = fullName.trim();

    if (!fullName || !email || !password || !role) {
        throw new Error("Please fill in all required fields.");
    }

    if (password.length < 6) {
        throw new Error("Password must be at least 6 characters.");
    }

    if (!supabaseConfig.isConfigured() || !supabase) {
        throw new Error("Supabase is not configured. Registration is unavailable.");
    }

    {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: {
                    full_name: fullName,
                    role: role
                }
            }
        });

        if (error) throw error;

        if (data && data.user) {
            // If session was granted, establish session
            if (data.session) {
                const { error: profileError } = await supabase.from("profiles").upsert({
                    id: data.user.id,
                    email,
                    full_name: fullName,
                    role,
                    status: "active"
                });
                if (profileError) throw profileError;

                const profile = {
                    id: data.user.id,
                    email,
                    full_name: fullName,
                    role,
                    status: "active"
                };
                session.setSession({
                    user: data.user,
                    profile,
                    role,
                    token: data.session.access_token
                });
                return { success: true, profile, needConfirmation: false };
            }

            return { success: true, needConfirmation: true };
        }

        throw new Error("Supabase registration did not create an account. Please try again.");
    }

}

/**
 * Perform Logout
 */
export async function logout() {
    const profile = session.getProfile();

    if (profile) {
        try {
            await recordAuditEvent({
                userId: profile.id,
                action: "LOGOUT",
                module: "Auth",
                recordId: profile.id,
                description: `${profile.full_name} logged out`
            });
        } catch (e) {
            console.warn("Could not log logout event:", e);
        }
    }

    if (supabaseConfig.isConfigured() && supabase) {
        try {
            await supabase.auth.signOut();
        } catch (e) {
            console.warn("Supabase signOut error:", e);
        }
    }

    session.clearSession();

    // Calculate relative path to login.html
    const isUnderPages = window.location.pathname.includes("/pages/");
    const pathToLogin = isUnderPages ? "../../login.html?v=2.6" : "./login.html?v=2.6";
    window.location.replace(pathToLogin);
}

/**
 * Initialize Login Form Page Listeners
 */
export function initLoginPage() {
    const form = document.getElementById("login-form");
    const emailInput = document.getElementById("login-email");
    const passwordInput = document.getElementById("login-password");
    const submitBtn = document.getElementById("login-submit-btn");
    const errorAlert = document.getElementById("login-error-alert");

    // Tab Switchers
    const tabSignIn = document.getElementById("tab-btn-signin");
    const tabRegister = document.getElementById("tab-btn-register");
    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const demoContainer = document.getElementById("demo-accounts-container");
    const successAlert = document.getElementById("login-success-alert");

    if (supabaseConfig.isConfigured() && demoContainer) {
        demoContainer.style.display = "none";
    }

    if (tabSignIn && tabRegister) {
        tabSignIn.addEventListener("click", () => {
            tabSignIn.style.borderBottom = "2px solid var(--brand-blue)";
            tabSignIn.style.color = "var(--brand-blue)";
            tabSignIn.style.fontWeight = "600";
            tabRegister.style.borderBottom = "2px solid transparent";
            tabRegister.style.color = "var(--text-muted)";
            tabRegister.style.fontWeight = "500";

            if (loginForm) loginForm.style.display = "block";
            if (registerForm) registerForm.style.display = "none";
            if (demoContainer) demoContainer.style.display = "block";
            clearError();
        });

        tabRegister.addEventListener("click", () => {
            tabRegister.style.borderBottom = "2px solid var(--brand-blue)";
            tabRegister.style.color = "var(--brand-blue)";
            tabRegister.style.fontWeight = "600";
            tabSignIn.style.borderBottom = "2px solid transparent";
            tabSignIn.style.color = "var(--text-muted)";
            tabSignIn.style.fontWeight = "500";

            if (loginForm) loginForm.style.display = "none";
            if (registerForm) registerForm.style.display = "block";
            if (demoContainer) demoContainer.style.display = "none";
            clearError();
        });
    }

    function clearError() {
        if (errorAlert) {
            errorAlert.style.display = "none";
            errorAlert.textContent = "";
        }
        if (successAlert) {
            successAlert.style.display = "none";
            successAlert.textContent = "";
        }
    }

    function showError(msg) {
        if (errorAlert) {
            errorAlert.style.display = "block";
            errorAlert.textContent = msg;
        }
    }

    function showSuccess(msg) {
        if (successAlert) {
            successAlert.style.display = "block";
            successAlert.textContent = msg;
        }
    }

    if (form) {
        form.addEventListener("submit", async (e) => {
            e.preventDefault();
            clearError();

            const email = emailInput.value.trim();
            const password = passwordInput.value;

            if (!email || !password) {
                showError("Please enter both email and password.");
                return;
            }

            submitBtn.disabled = true;
            submitBtn.innerHTML = `<span>Signing in...</span>`;

            try {
                const res = await login(email, password);
                if (res && res.success) {
                    window.location.replace("./dashboard.html");
                }
            } catch (err) {
                showError(err.message || "Login failed. Please check your credentials.");
                submitBtn.disabled = false;
                submitBtn.innerHTML = `<span>Sign In to Portal</span>`;
            }
        });
    }

    // Register Form submission
    if (registerForm) {
        registerForm.addEventListener("submit", async (e) => {
            e.preventDefault();
            clearError();

            const fullName = document.getElementById("reg-fullname").value.trim();
            const email = document.getElementById("reg-email").value.trim();
            const password = document.getElementById("reg-password").value;
            const role = document.getElementById("reg-role").value;
            const regSubmitBtn = document.getElementById("register-submit-btn");

            if (!fullName || !email || !password || !role) {
                showError("Please fill in all registration fields.");
                return;
            }

            regSubmitBtn.disabled = true;
            regSubmitBtn.innerHTML = `<span>Creating account...</span>`;

            try {
                const res = await registerUser({ fullName, email, password, role });
                if (res.needConfirmation) {
                    showSuccess("Account registered! If confirmation is required, please check your email, or sign in now.");
                    regSubmitBtn.disabled = false;
                    regSubmitBtn.innerHTML = `<span>Create Account &amp; Sign In</span>`;
                } else {
                    window.location.replace("./dashboard.html");
                }
            } catch (err) {
                showError(err.message || "Registration failed.");
                regSubmitBtn.disabled = false;
                regSubmitBtn.innerHTML = `<span>Create Account &amp; Sign In</span>`;
            }
        });
    }
}
