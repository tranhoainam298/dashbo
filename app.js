const CONFIG = { BFF_BASE_URL: 'http://localhost:3000/api', PAGE_SIZE: 20 };
const state = { mode: 'unified', page: 1, filter: 'all', search: '', totalPages: 1, charts: {}, chartRawData: [] };

const elements = {
    tbody: document.getElementById('table-body'),
    thead: document.getElementById('table-head'),
    alerts: document.getElementById('alerts-section'),
    charts: document.getElementById('charts-section'),
    spinner: document.getElementById('loading-spinner'),
    pageInput: document.getElementById('page-input'),
    pageLabel: document.getElementById('page-label'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    goBtn: document.getElementById('go-btn'),
    searchInput: document.getElementById('local-search')
};

// ==========================================
// 1. TÌM KIẾM TOÀN CẦU (GLOBAL SEARCH QUA API)
// ==========================================
let searchTimeout = null;
if (elements.searchInput) {
    elements.searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        // Chờ 0.5s sau khi gõ xong mới gọi API để chống sập Server
        searchTimeout = setTimeout(() => {
            state.search = e.target.value.trim();
            state.page = 1; 
            loadTableData();
        }, 500); 
    });
}

// ==========================================
// 2. ĐIỀU HƯỚNG VÀ LOAD DATA
// ==========================================
function switchView(mode) {
    state.mode = mode; state.page = 1; state.filter = 'all'; state.search = '';
    if(elements.searchInput) elements.searchInput.value = '';
    
    const badge = document.getElementById('current-filter-badge');
    const clearBtn = document.getElementById('clear-filter-btn');
    if(badge) badge.style.display = 'none';
    if(clearBtn) clearBtn.style.display = 'none';

    document.querySelectorAll('.sidebar li').forEach(el => el.classList.remove('active'));
    document.getElementById(`nav-${mode}`).classList.add('active');

    // Ẩn/hiện KPI Header
    const kpiContainer = document.getElementById('global-kpi');

    if (mode === 'unified') {
        elements.alerts.style.display = 'grid';
        elements.charts.style.display = 'grid';
        if(kpiContainer) kpiContainer.style.display = 'flex';
        
        elements.thead.innerHTML = `<tr><th>ID</th><th>Source</th><th>Name</th><th>Gender</th><th>Ethnicity</th><th>Dept</th><th>Earnings YTD</th><th>Vacation</th></tr>`;
        
        loadStats();
        loadChartsData();
    } else {
        elements.alerts.style.display = 'none';
        elements.charts.style.display = 'none';
        if(kpiContainer) kpiContainer.style.display = 'none';
        
        elements.thead.innerHTML = mode === 'hr' 
            ? `<tr><th>Name</th><th>City</th><th>Email</th><th>Gender</th><th>Shareholder</th></tr>` 
            : `<tr><th>Emp No</th><th>Name</th><th>SSN</th><th>Salary</th><th>Vacation</th></tr>`;
    }
    loadTableData();
}

async function loadTableData() {
    elements.spinner.classList.remove('hidden');
    try {
        // Gọi API nạp bảng kèm biến search (để tìm kiếm toàn máy chủ)
        const url = `${CONFIG.BFF_BASE_URL}/employees/${state.mode}?page=${state.page}&limit=${CONFIG.PAGE_SIZE}&filter=${state.filter}&search=${encodeURIComponent(state.search)}`;
        const res = await fetch(url);
        const result = await res.json();
        
        elements.tbody.innerHTML = result.data.map(emp => {
            if (state.mode === 'unified') {
                const hrActive = (emp.source === 'both' || emp.source === 'hr') ? 'active' : '';
                const prActive = (emp.source === 'both' || emp.source === 'payroll') ? 'active' : '';
                const linkIcon = emp.source === 'both' ? '<i class="fa-solid fa-link link-chain"></i>' : '';

                return `<tr>
                    <td><strong>${emp.id || '---'}</strong></td>
                    <td>
                        <div class="source-link">
                            <span class="source-icon ${hrActive}" title="HR System">🏥</span>
                            ${linkIcon}
                            <span class="source-icon ${prActive}" title="Payroll System">💰</span>
                        </div>
                    </td>
                    <td><strong>${emp.name}</strong></td>
                    <td>${emp.gender || 'Unknown'}</td>
                    <td>${emp.ethnicity || 'Unknown'}</td>
                    <td>${emp.department || '---'}</td>
                    <td style="color:#3498db;font-weight:bold">$${(emp.salaryYTD||0).toLocaleString()}</td>
                    <td style="color:${emp.vacationYTD>15?'red':'inherit'};font-weight:bold">${emp.vacationYTD || 0}</td>
                </tr>`;
            } else if (state.mode === 'hr') {
                return `<tr><td>${emp.name}</td><td>${emp.city}</td><td>${emp.email}</td><td>${emp.gender}</td><td>${emp.shareholder}</td></tr>`;
            } else {
                return `<tr><td>${emp.empNumber}</td><td>${emp.name}</td><td>${emp.ssn}</td><td>${emp.salaryStr}</td><td>${emp.vacationStr}</td></tr>`;
            }
        }).join('');

        state.totalPages = result.pagination.totalPages;
        elements.pageLabel.innerText = `of ${state.totalPages.toLocaleString()}`;
        elements.pageInput.value = state.page;
        elements.prevBtn.disabled = state.page === 1;
        elements.nextBtn.disabled = state.page === state.totalPages;
    } catch(e) { console.error("Lỗi nạp bảng:", e); }
    elements.spinner.classList.add('hidden');
}

// ==========================================
// 3. DRILL-DOWN & KPI STATS
// ==========================================
async function loadStats() {
    try {
        const res = await fetch(`${CONFIG.BFF_BASE_URL}/dashboard/stats`);
        const stats = await res.json();
        
        // Nạp số liệu Cảnh báo
        document.getElementById('alert-bday-val').innerText = stats.alerts.birthday.toLocaleString();
        document.getElementById('alert-anniv-val').innerText = stats.alerts.anniversary.toLocaleString();
        document.getElementById('alert-vac-val').innerText = stats.alerts.vacation.toLocaleString();
        document.getElementById('alert-ben-val').innerText = stats.alerts.benefits.toLocaleString();

        // NẠP SỐ LIỆU KPI TỔNG QUAN
        const kpiHeadcount = document.getElementById('kpi-headcount');
        const kpiPayroll = document.getElementById('kpi-payroll');
        if(kpiHeadcount) kpiHeadcount.innerText = stats.totalUnified.toLocaleString();
        if(kpiPayroll) kpiPayroll.innerText = '$' + (stats.totalEarnings || 0).toLocaleString();

    } catch(e) {}
}

window.drillDown = (type) => { 
    state.filter = type; state.page = 1; 
    document.getElementById('current-filter-badge').innerText = `Filter: ${type.toUpperCase()}`;
    document.getElementById('current-filter-badge').style.display = 'inline-block';
    document.getElementById('clear-filter-btn').style.display = 'inline-block';
    loadTableData(); 
};

window.clearFilter = () => { 
    state.filter = 'all'; state.page = 1; 
    if(elements.searchInput) elements.searchInput.value = '';
    state.search = '';
    document.getElementById('current-filter-badge').style.display = 'none';
    document.getElementById('clear-filter-btn').style.display = 'none';
    loadTableData(); 
};

// ==========================================
// 4. VẼ BIỂU ĐỒ CEO MEMO
// ==========================================
async function loadChartsData() {
    try {
        const res = await fetch(`${CONFIG.BFF_BASE_URL}/dashboard/charts`);
        state.chartRawData = await res.json();
        if (state.chartRawData && state.chartRawData.length > 0) {
            renderEarningsChart();
            renderVacationChart();
            renderBenefitsChart();
        }
    } catch(e) { console.error("Lỗi tải data biểu đồ", e); }
}

window.renderEarningsChart = function() {
    const dimension = document.getElementById('earn-dimension') ? document.getElementById('earn-dimension').value : 'department';
    const data = state.chartRawData;
    const labels = [...new Set(data.map(d => d[dimension] || 'Unknown'))];
    
    const earnYTD = labels.map(lbl => data.filter(d => d[dimension] === lbl).reduce((s, d)=>s+(d.salaryYTD||0), 0));
    const earnPrev = labels.map(lbl => data.filter(d => d[dimension] === lbl).reduce((s, d)=>s+(d.salaryPrev||0), 0));

    if(state.charts.earn) state.charts.earn.destroy();
    state.charts.earn = new Chart(document.getElementById('earningsChart'), {
        type: 'bar', 
        data: { labels: labels, datasets: [{label: 'YTD ($)', data: earnYTD, backgroundColor: '#3498db'}, {label: 'Prev Year ($)', data: earnPrev, backgroundColor: '#95a5a6'}] },
        options: { maintainAspectRatio: false }
    });
}

window.renderVacationChart = function() {
    const dimension = document.getElementById('vac-dimension') ? document.getElementById('vac-dimension').value : 'empType';
    const data = state.chartRawData;
    const labels = [...new Set(data.map(d => d[dimension] || 'Unknown'))];
    
    const vacYtd = labels.map(lbl => data.filter(d => d[dimension] === lbl).reduce((s, d)=>s+(d.vacationYTD||0), 0));
    const vacPrev = labels.map(lbl => data.filter(d => d[dimension] === lbl).reduce((s, d)=>s+(d.vacationPrev||0), 0));

    if(state.charts.vac) state.charts.vac.destroy();
    state.charts.vac = new Chart(document.getElementById('vacationChart'), {
        type: 'bar', 
        data: { labels: labels, datasets: [{label: 'YTD (Days)', data: vacYtd, backgroundColor: '#e74c3c'}, {label: 'Prev Year', data: vacPrev, backgroundColor: '#f39c12'}] },
        options: { maintainAspectRatio: false }
    });
}

function renderBenefitsChart() {
    const data = state.chartRawData;
    const plans = [...new Set(data.map(d => d.benefitPlan || 'Unknown'))];
    
    const shAvg = plans.map(p => { let l = data.filter(d => d.benefitPlan===p && d.shareholder==='Yes'); return l.length ? l.reduce((s,e)=>s+(e.benefitsCost||0),0)/l.length : 0; });
    const nonAvg = plans.map(p => { let l = data.filter(d => d.benefitPlan===p && d.shareholder==='No'); return l.length ? l.reduce((s,e)=>s+(e.benefitsCost||0),0)/l.length : 0; });

    if(state.charts.ben) state.charts.ben.destroy();
    state.charts.ben = new Chart(document.getElementById('benefitsChart'), {
        type: 'bar', 
        data: { labels: plans, datasets: [{label: 'Shareholder (Avg $)', data: shAvg, backgroundColor: '#2ecc71'}, {label: 'Non-Shareholder', data: nonAvg, backgroundColor: '#34495e'}] },
        options: { maintainAspectRatio: false }
    });
}

// ==========================================
// 5. NÚT ĐIỀU KHIỂN
// ==========================================
if(elements.prevBtn) elements.prevBtn.onclick = () => { if(state.page > 1) { state.page--; loadTableData(); } };
if(elements.nextBtn) elements.nextBtn.onclick = () => { if(state.page < state.totalPages) { state.page++; loadTableData(); } };
if(elements.goBtn) elements.goBtn.onclick = () => { 
    const target = parseInt(elements.pageInput.value);
    if(target >= 1 && target <= state.totalPages) { state.page = target; loadTableData(); } 
};
document.getElementById('nav-unified').onclick = () => switchView('unified');
document.getElementById('nav-hr').onclick = () => switchView('hr');
document.getElementById('nav-payroll').onclick = () => switchView('payroll');

document.addEventListener('DOMContentLoaded', () => switchView('unified'));