/**
 * FinOps Platform – Authentication helpers
 */

function saveToken(tokenData) {
    localStorage.setItem('access_token', tokenData.access_token);
    localStorage.setItem('token_type',   tokenData.token_type);
}

function clearToken() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('token_type');
    localStorage.removeItem('user_email');
}

function isLoggedIn() {
    return !!localStorage.getItem('access_token');
}

function requireAuth() {
    if (!isLoggedIn()) {
        window.location.href = 'index.html';
    }
}

function logout() {
    clearToken();
    window.location.href = 'index.html';
}

// ─── Login form handler ───────────────────────────────────────────────────────

async function handleLoginForm(e) {
    e.preventDefault();
    const email    = document.getElementById('email').value.trim();
    const password = document.getElementById('password').value;
    const errBox   = document.getElementById('loginError');
    const btn      = document.getElementById('loginBtn');

    errBox.textContent = '';
    btn.disabled = true;
    btn.textContent = 'Connexion…';

    try {
        const data = await login(email, password);
        saveToken(data);
        localStorage.setItem('user_email', email);
        window.location.href = 'dashboard.html';
    } catch (err) {
        errBox.textContent = err.detail || 'Identifiants invalides';
    } finally {
        btn.disabled = false;
        btn.textContent = 'Se connecter';
    }
}

// ─── Register form handler ───────────────────────────────────────────────────

async function handleRegisterForm(e) {
    e.preventDefault();
    const email     = document.getElementById('regEmail').value.trim();
    const password  = document.getElementById('regPassword').value;
    const full_name = document.getElementById('regName').value.trim();
    const errBox    = document.getElementById('registerError');
    const btn       = document.getElementById('registerBtn');

    errBox.textContent = '';
    btn.disabled = true;

    try {
        await register(email, password, full_name);
        // Auto-login after register
        const data = await login(email, password);
        saveToken(data);
        localStorage.setItem('user_email', email);
        window.location.href = 'dashboard.html';
    } catch (err) {
        errBox.textContent = err.detail || 'Inscription échouée';
    } finally {
        btn.disabled = false;
    }
}
