/**
 * FinOps Platform – Costs page logic
 * Handles: list, add, edit, delete costs with full TVA support.
 */

let allCosts = [];
const COL_COUNT = 10; // number of <th> columns in the costs table

// ─── Boot ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    requireAuth();
    document.getElementById('userEmail').textContent =
        localStorage.getItem('user_email') || '';
    loadCosts();
    loadTotalStats();
    setupCostForm();
    document.getElementById('logoutBtn').addEventListener('click', logout);
    document.getElementById('refreshBtn').addEventListener('click', () => {
        loadCosts();
        loadTotalStats();
    });
    document.getElementById('filterBtn').addEventListener('click', applyFilters);
    document.getElementById('resetFilterBtn').addEventListener('click', resetFilters);
});

// ─── Load & display costs ─────────────────────────────────────────────────────

async function loadCosts(params = {}) {
    const tbody  = document.getElementById('costsBody');
    const status = document.getElementById('costsStatus');
    tbody.innerHTML  = `<tr><td colspan="${COL_COUNT}" class="loading">Chargement…</td></tr>`;
    status.textContent = '';

    try {
        allCosts = await getCosts(params);
        renderCostsTable(allCosts);
        status.textContent = `${allCosts.length} enregistrement(s)`;
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="${COL_COUNT}" class="error">Erreur : ${err.detail || err}</td></tr>`;
    }
}

function renderCostsTable(costs) {
    const tbody = document.getElementById('costsBody');
    if (!costs.length) {
        tbody.innerHTML = `<tr><td colspan="${COL_COUNT}" class="empty">Aucun coût enregistré.</td></tr>`;
        return;
    }

    tbody.innerHTML = costs.map(c => {
        const tvaRate   = c.tva_rate   != null ? `${(c.tva_rate * 100).toFixed(0)} %` : '—';
        const tvaAmount = c.tva_amount != null ? `${c.tva_amount.toFixed(2)} ${c.currency}` : '—';
        const amountTtc = c.amount_ttc != null ? `${c.amount_ttc.toFixed(2)} ${c.currency}` : '—';

        return `
        <tr>
            <td>${c.id}</td>
            <td>${c.cost_date}</td>
            <td>${esc(c.service_name)}</td>
            <td class="amount">${c.amount.toFixed(2)} ${c.currency}</td>
            <td class="tva">${tvaRate}</td>
            <td class="tva">${tvaAmount}</td>
            <td class="tva amount-ttc">${amountTtc}</td>
            <td>${esc(c.project_id || '—')}</td>
            <td>${esc(c.team_id    || '—')}</td>
            <td class="actions">
                <button class="btn-edit"   onclick="openEditModal(${c.id})">✏️</button>
                <button class="btn-delete" onclick="confirmDelete(${c.id})">🗑️</button>
            </td>
        </tr>`;
    }).join('');
}

// ─── Total stats banner ───────────────────────────────────────────────────────

async function loadTotalStats() {
    try {
        const t = await getTotalCost();
        document.getElementById('statHT').textContent  = `${t.total_ht.toFixed(2)} €`;
        document.getElementById('statTVA').textContent = `${t.tva_amount.toFixed(2)} €`;
        document.getElementById('statTTC').textContent = `${t.total_ttc.toFixed(2)} €`;
        document.getElementById('statCount').textContent = t.count;
    } catch (_) { /* stats are non-critical */ }
}

// ─── Filters ─────────────────────────────────────────────────────────────────

function applyFilters() {
    const p = {};
    const svc   = document.getElementById('fService').value.trim();
    const proj  = document.getElementById('fProject').value.trim();
    const start = document.getElementById('fStart').value;
    const end   = document.getElementById('fEnd').value;
    if (svc)   p.service    = svc;
    if (proj)  p.project    = proj;
    if (start) p.start_date = start;
    if (end)   p.end_date   = end;
    loadCosts(p);
}

function resetFilters() {
    ['fService','fProject','fStart','fEnd'].forEach(id => {
        document.getElementById(id).value = '';
    });
    loadCosts();
}

// ─── Add / Edit modal ─────────────────────────────────────────────────────────

function setupCostForm() {
    document.getElementById('openAddBtn').addEventListener('click', openAddModal);
    document.getElementById('closeModal').addEventListener('click', closeModal);
    document.getElementById('cancelBtn').addEventListener('click', closeModal);
    document.getElementById('costForm').addEventListener('submit', handleCostSubmit);
    // Close on backdrop click
    document.getElementById('costModal').addEventListener('click', e => {
        if (e.target === document.getElementById('costModal')) closeModal();
    });
}

function openAddModal() {
    document.getElementById('modalTitle').textContent = 'Ajouter un coût';
    document.getElementById('costForm').reset();
    document.getElementById('costId').value = '';
    document.getElementById('costModal').classList.add('open');
    document.getElementById('costDate').focus();
}

async function openEditModal(id) {
    const cost = allCosts.find(c => c.id === id);
    if (!cost) return;

    document.getElementById('modalTitle').textContent = 'Modifier le coût';
    document.getElementById('costId').value        = cost.id;
    document.getElementById('costDate').value      = cost.cost_date;
    document.getElementById('costService').value   = cost.service_name;
    document.getElementById('costAmount').value    = cost.amount;
    document.getElementById('costCurrency').value  = cost.currency;
    document.getElementById('costProject').value   = cost.project_id || '';
    document.getElementById('costTeam').value      = cost.team_id    || '';
    document.getElementById('costCategory').value  = cost.cost_category || '';
    // tva_rate stored as decimal (0.20 for 20 %) — show as percentage in input
    document.getElementById('costTvaRate').value   =
        cost.tva_rate != null ? (cost.tva_rate * 100).toFixed(2) : '';

    document.getElementById('costModal').classList.add('open');
}

function closeModal() {
    document.getElementById('costModal').classList.remove('open');
}

async function handleCostSubmit(e) {
    e.preventDefault();
    const errBox = document.getElementById('formError');
    errBox.textContent = '';

    const id        = document.getElementById('costId').value;
    const tvaInput  = document.getElementById('costTvaRate').value.trim();

    const payload = {
        cost_date:     document.getElementById('costDate').value,
        service_name:  document.getElementById('costService').value.trim(),
        amount:        parseFloat(document.getElementById('costAmount').value),
        currency:      document.getElementById('costCurrency').value.trim() || 'EUR',
        project_id:    document.getElementById('costProject').value.trim()  || null,
        team_id:       document.getElementById('costTeam').value.trim()     || null,
        cost_category: document.getElementById('costCategory').value.trim() || null,
        // Convert % → decimal (e.g. "20" → 0.20); null if empty
        tva_rate: tvaInput !== '' ? parseFloat(tvaInput) / 100 : null,
    };

    const btn = document.getElementById('submitBtn');
    btn.disabled = true;

    try {
        if (id) {
            await updateCost(id, payload);
        } else {
            await createCost(payload);
        }
        closeModal();
        loadCosts();
        loadTotalStats();
    } catch (err) {
        errBox.textContent = err.detail || 'Erreur lors de la sauvegarde';
    } finally {
        btn.disabled = false;
    }
}

// ─── Delete ───────────────────────────────────────────────────────────────────

async function confirmDelete(id) {
    if (!confirm(`Supprimer le coût #${id} ?`)) return;
    try {
        await deleteCost(id);
        loadCosts();
        loadTotalStats();
    } catch (err) {
        alert(`Erreur : ${err.detail || err}`);
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
