/**
 * Executive Dashboard - Presentation Integration Layer
 * Chế độ: NỐI TIẾP PHÂN TRANG (Sequential Pagination)
 * Trang 1 -> 9430: Hiển thị HR
 * Trang 9431 -> 20331: Hiển thị Payroll
 */

const CONFIG = {
    PAYROLL_URL: (page) => `http://localhost:8080/springapp/admin/employee/list.html?page=${page}`,
    HR_URL: (page) => `http://localhost:19335/Personals?page=${page}`,
    HR_TOTAL_PAGES: 9430,
    PAYROLL_TOTAL_PAGES: 10901,
    get MAX_PAGES() { return this.HR_TOTAL_PAGES + this.PAYROLL_TOTAL_PAGES; }
};

const state = {
    currentPage: 1,
    currentData: [], 
    cache: new Map() 
};

const elements = {
    tbody: document.getElementById('table-body'),
    spinner: document.getElementById('loading-spinner'),
    errorContainer: document.getElementById('error-container'),
    pageInput: document.getElementById('page-input'),
    prevBtn: document.getElementById('prev-btn'),
    nextBtn: document.getElementById('next-btn'),
    goBtn: document.getElementById('go-btn'),
    refreshBtn: document.getElementById('refresh-btn'),
    searchInput: document.getElementById('local-search'),
    kpiTotal: document.getElementById('kpi-total'),
    kpiHR: document.getElementById('kpi-hr'),
    kpiPayroll: document.getElementById('kpi-payroll'),
    lastUpdated: document.getElementById('last-updated')
};

// ==========================================
// FETCH & PARSE HTML
// ==========================================

async function fetchHRPage(page) {
    try {
        const response = await fetch(CONFIG.HR_URL(page));
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        
        const rows = doc.querySelectorAll('table tbody tr, table tr');
        const parsedData = [];

        rows.forEach(row => {
            const cells = row.querySelectorAll('td');
            if (cells.length > 0) {
                const name = cells[0]?.innerText.trim();
                if (name) {
                    parsedData.push({
                        empNumber: '---',                   // HR không có mã NV
                        name: name,                         // Full Name
                        email: cells[2]?.innerText.trim() || '---',  // Email
                        phone: cells[3]?.innerText.trim() || '---',  // Phone
                        salary: '---',                      // Không có dữ liệu Payroll
                        vacation: '---'                     // Không có dữ liệu Payroll
                    });
                }
            }
        });
        return parsedData;
    } catch (error) {
        console.error("HR Fetch Error:", error);
        throw new Error("HR system unavailable");
    }
}

async function fetchPayrollPage(page) {
    try {
        // THÊM { credentials: 'include' } VÀO ĐÂY:
        const response = await fetch(CONFIG.PAYROLL_URL(page), {
            credentials: 'include' 
        });
        
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        
        const html = await response.text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        
        const rows = doc.querySelectorAll('table tr'); 
        const parsedData = [];

        let countDataRows = 0;

        rows.forEach((row, index) => {
            const cells = row.querySelectorAll('td');
            if (cells.length > 0) {
                countDataRows++;
                parsedData.push({
                    empNumber: cells[0]?.innerText.trim() || '---', 
                    name: cells[1]?.innerText.trim() || 'Chưa rõ tên', 
                    email: '---',                                   
                    phone: '---',                                   
                    salary: cells[3]?.innerText.trim() || '---',    
                    vacation: cells[4]?.innerText.trim() || '---'   
                });
            }
        });

        return parsedData;
    } catch (error) {
        console.error("Payroll Fetch Error:", error);
        throw new Error("Payroll system unavailable");
    }
}
// ==========================================
// UI RENDERING
// ==========================================

function renderTable(data) {
    elements.tbody.innerHTML = '';
    
    if (data.length === 0) {
        elements.tbody.innerHTML = `<tr><td colspan="6" style="text-align:center">No records found on this page.</td></tr>`;
        return;
    }

    data.forEach(emp => {
        const tr = document.createElement('tr');
        
        // Render với dấu --- nếu không có dữ liệu
        tr.innerHTML = `
            <td><strong>${emp.empNumber}</strong></td>
            <td>${emp.name}</td>
            <td>${emp.email}</td>
            <td>${emp.phone}</td>
            <td>${emp.salary}</td>
            <td>${emp.vacation}</td>
        `;
        elements.tbody.appendChild(tr);
    });
}

function updateKPIs(total, hrStatus, payrollStatus) {
    elements.kpiTotal.innerText = total;
    
    elements.kpiHR.innerText = hrStatus;
    elements.kpiHR.className = `kpi-value ${hrStatus === 'Online' ? 'status-online' : (hrStatus === 'Standby' ? 'text-secondary' : 'status-offline')}`;

    elements.kpiPayroll.innerText = payrollStatus;
    elements.kpiPayroll.className = `kpi-value ${payrollStatus === 'Online' ? 'status-online' : (payrollStatus === 'Standby' ? 'text-secondary' : 'status-offline')}`;
}

function updatePaginationUI() {
    elements.pageInput.value = state.currentPage;
    elements.pageInput.max = CONFIG.MAX_PAGES;
    document.querySelector('.page-controls span').innerText = `Page (Max: ${CONFIG.MAX_PAGES})`;
    
    elements.prevBtn.disabled = state.currentPage <= 1;
    elements.nextBtn.disabled = state.currentPage >= CONFIG.MAX_PAGES;
}

// ==========================================
// ORCHESTRATION LÕI: LOGIC NỐI TIẾP
// ==========================================

async function loadDashboardData(page, forceRefresh = false) {
    elements.spinner.classList.remove('hidden');
    elements.errorContainer.innerHTML = ''; 
    elements.searchInput.value = ''; 

    if (!forceRefresh && state.cache.has(page)) {
        state.currentData = state.cache.get(page);
        renderTable(state.currentData);
        // Nếu trang <= 9430 thì HR Online, Payroll Standby. Ngược lại.
        updateKPIs(state.currentData.length, page <= CONFIG.HR_TOTAL_PAGES ? 'Online' : 'Standby', page > CONFIG.HR_TOTAL_PAGES ? 'Online' : 'Standby');
        updatePaginationUI();
        elements.spinner.classList.add('hidden');
        return;
    }

    let resultData = [];
    let hrStatus = 'Standby';
    let payrollStatus = 'Standby';

    try {
        // PHÂN LUỒNG LOGIC TẠI ĐÂY
        if (page <= CONFIG.HR_TOTAL_PAGES) {
            // Đang ở phân khúc của HR (Trang 1 -> 9430)
            resultData = await fetchHRPage(page);
            hrStatus = 'Online';
        } else {
            // Đang ở phân khúc của Payroll (Trang 9431 -> 20331)
            // Tính toán lại số trang thực tế cần gọi bên Payroll
            const actualPayrollPage = page - CONFIG.HR_TOTAL_PAGES; 
            resultData = await fetchPayrollPage(actualPayrollPage);
            payrollStatus = 'Online';
        }

        state.currentData = resultData;
        state.cache.set(page, state.currentData); // Lưu vào bộ nhớ tạm để bấm Next/Prev nhanh hơn
        
        renderTable(state.currentData);
        updateKPIs(state.currentData.length, hrStatus, payrollStatus);
        updatePaginationUI();
        
    } catch (error) {
        showErrorBanner(error.message);
        if (page <= CONFIG.HR_TOTAL_PAGES) hrStatus = 'Offline';
        else payrollStatus = 'Offline';
        updateKPIs(0, hrStatus, payrollStatus);
    }

    const now = new Date();
    elements.lastUpdated.innerText = `Last Updated: ${now.toLocaleTimeString()}`;
    elements.spinner.classList.add('hidden');
}

function showErrorBanner(message) {
    const div = document.createElement('div');
    div.className = 'error-banner';
    div.innerText = `⚠️ System Error: ${message}`;
    elements.errorContainer.appendChild(div);
}

// ==========================================
// EVENT LISTENERS
// ==========================================

elements.prevBtn.addEventListener('click', () => {
    if (state.currentPage > 1) {
        state.currentPage--;
        loadDashboardData(state.currentPage);
    }
});

elements.nextBtn.addEventListener('click', () => {
    if (state.currentPage < CONFIG.MAX_PAGES) {
        state.currentPage++;
        loadDashboardData(state.currentPage);
    }
});

elements.goBtn.addEventListener('click', () => {
    let targetPage = parseInt(elements.pageInput.value, 10);
    if (targetPage >= 1 && targetPage <= CONFIG.MAX_PAGES) {
        state.currentPage = targetPage;
        loadDashboardData(state.currentPage);
    } else {
        alert(`Please enter a valid page number between 1 and ${CONFIG.MAX_PAGES}`);
        elements.pageInput.value = state.currentPage;
    }
});

elements.refreshBtn.addEventListener('click', () => {
    loadDashboardData(state.currentPage, true);
});

let searchTimeout;
elements.searchInput.addEventListener('input', (e) => {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => {
        const query = e.target.value.toLowerCase();
        const filteredData = state.currentData.filter(emp => {
            return (
                (emp.name && emp.name.toLowerCase().includes(query)) ||
                (emp.empNumber && emp.empNumber.toLowerCase().includes(query)) ||
                (emp.email && emp.email.toLowerCase().includes(query))
            );
        });
        renderTable(filteredData);
    }, 300);
});

// Init
document.addEventListener('DOMContentLoaded', () => {
    loadDashboardData(state.currentPage);
});