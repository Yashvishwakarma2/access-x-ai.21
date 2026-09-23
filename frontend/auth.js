const localHosts = ["localhost", "127.0.0.1"];
const API_BASE_URL = localHosts.includes(window.location.hostname)
    ? "/api"
    : "https://access-x-ai21-production.up.railway.app/api";
let mode = "login";

const form = document.getElementById("authForm");
const nameField = document.getElementById("nameField");
const nameInput = document.getElementById("name");
const passwordInput = document.getElementById("password");
const passwordHint = document.getElementById("passwordHint");
const message = document.getElementById("authMessage");
const submitButton = document.getElementById("submitButton");

function setMode(nextMode) {
    mode = nextMode;
    const registerMode = mode === "register";
    nameField.classList.toggle("hidden", !registerMode);
    nameInput.required = registerMode;
    passwordInput.autocomplete = registerMode ? "new-password" : "current-password";
    passwordHint.classList.toggle("hidden", !registerMode);
    document.getElementById("authTitle").textContent = registerMode ? "Create your account" : "Sign in to your workspace";
    document.getElementById("authSubtitle").textContent = registerMode ? "Set up secure access to your logistics workspace." : "Use your Access-X-AI account to continue.";
    submitButton.textContent = registerMode ? "Create account securely" : "Sign in securely";
    message.textContent = "";
    document.querySelectorAll(".auth-tab").forEach(tab => {
        const active = tab.dataset.mode === mode;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", active ? "true" : "false");
    });
}

document.querySelectorAll(".auth-tab").forEach(tab => tab.addEventListener("click", () => setMode(tab.dataset.mode)));
document.getElementById("togglePassword").addEventListener("click", event => {
    const visible = passwordInput.type === "text";
    passwordInput.type = visible ? "password" : "text";
    event.currentTarget.textContent = visible ? "Show" : "Hide";
    event.currentTarget.setAttribute("aria-label", visible ? "Show password" : "Hide password");
});

form.addEventListener("submit", async event => {
    event.preventDefault();
    message.textContent = "";
    submitButton.disabled = true;
    submitButton.textContent = "Checking...";

    const payload = {
        email: document.getElementById("email").value.trim(),
        password: passwordInput.value
    };
    if (mode === "register") payload.name = nameInput.value.trim();

    try {
        const response = await fetch(`${API_BASE_URL}/auth/${mode === "register" ? "register" : "login"}`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const responseText = await response.text();
        let data = {};
        try {
            data = responseText ? JSON.parse(responseText) : {};
        } catch {
            throw new Error("Authentication server returned an invalid response. Check the backend deployment.");
        }
        if (!response.ok) {
            if (response.status === 404) {
                throw new Error("Authentication is not enabled on the deployed server yet. Redeploy the Flask backend.");
            }
            throw new Error(data.error || `Authentication failed (${response.status}).`);
        }
        window.location.assign("/");
    } catch (error) {
        message.textContent = error.message;
        submitButton.disabled = false;
        submitButton.textContent = mode === "register" ? "Create account securely" : "Sign in securely";
    }
});
