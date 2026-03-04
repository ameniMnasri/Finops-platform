/**
 * FinOps Platform – API client
 * Base URL is read from localStorage so it can be overridden at runtime.
 */

const API_BASE = (localStorage.getItem('api_base') || 'http://localhost:8000') + '/api/v1';

function getAuthHeaders() {
    const token = localStorage.getItem('access_token');
    return {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    };
}

// ─── Generic request ────────────────────────────────────────────────────────

async function apiRequest(method, path, body = null) {
    console.log(`🚀 ${method} ${path}`);
    const opts = { method, headers: getAuthHeaders() };
    if (body !== null) opts.body = JSON.stringify(body);

    const res = await fetch(API_BASE + path, opts);
    let data;
    try { data = await res.json(); } catch { data = null; }

    if (!res.ok) {
        console.error(`❌ ${res.status} ${path} `, data);
        throw { status: res.status, detail: data?.detail || 'Unknown error', data };
    }
    console.log(`✅ ${res.status} ${path}`);
    return data;
}

// ─── Auth ────────────────────────────────────────────────────────────────────

async function login(email, password) {
    return apiRequest('POST', '/auth/login', { email, password });
}

async function register(email, password, full_name) {
    return apiRequest('POST', '/auth/register', { email, password, full_name });
}

async function getMe() {
    return apiRequest('GET', '/auth/me');
}

// ─── Costs ───────────────────────────────────────────────────────────────────

async function getCosts(params = {}) {
    const qs = new URLSearchParams({ skip: 0, limit: 5000, ...params }).toString();
    return apiRequest('GET', `/costs/?${qs}`);
}

async function createCost(payload) {
    return apiRequest('POST', '/costs/', payload);
}

async function updateCost(id, payload) {
    return apiRequest('PUT', `/costs/${id}`, payload);
}

async function deleteCost(id) {
    // DELETE returns 204 – no body
    const res = await fetch(`${API_BASE}/costs/${id}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
    });
    if (!res.ok) {
        let data;
        try { data = await res.json(); } catch { data = null; }
        throw { status: res.status, detail: data?.detail || 'Delete failed', data };
    }
    return true;
}

async function getTotalCost(startDate, endDate) {
    const p = {};
    if (startDate) p.start_date = startDate;
    if (endDate)   p.end_date   = endDate;
    const qs = new URLSearchParams(p).toString();
    return apiRequest('GET', `/costs/stats/total${qs ? '?' + qs : ''}`);
}

async function getSummaryByService() {
    return apiRequest('GET', '/costs/summary/service');
}

// ─── Files ───────────────────────────────────────────────────────────────────

async function uploadFile(file) {
    const token = localStorage.getItem('access_token');
    const form  = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/files/upload`, {
        method: 'POST',
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
        body: form
    });
    const data = await res.json();
    if (!res.ok) throw { status: res.status, detail: data?.detail || 'Upload failed', data };
    return data;
}

async function parseFile(fileId) {
    return apiRequest('POST', `/files/${fileId}/parse`);
}
