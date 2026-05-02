const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const fs = require('fs');
const readline = require('readline');
const { Pool } = require('pg');
const amqp = require('amqplib');

const app = express();
app.use(cors());
app.use(express.json()); // Đọc dữ liệu JSON từ UI gửi lên
// 👉 Lệnh cho Node.js tự động làm Host cho file index.html
app.use(express.static(__dirname));

// ==========================================
// CẤU HÌNH DATABASE POSTGRESQL (Nguồn trung tâm duy nhất)
// ==========================================
const pool = new Pool({
    // Đổi mật khẩu nếu cần
    connectionString: 'postgres://postgres:123456@localhost:5432/acme_corp_db'
});

// --- BỘ NHỚ RAM & TỆP LƯU TRỮ ---
const CACHE_META = './cache-meta.json';
const CACHE_HR = './cache-hr.jsonl';
const CACHE_PAYROLL = './cache-payroll.jsonl';
const CACHE_UNIFIED = './cache-unified.jsonl';

let cachedHR = [];
let cachedPayroll = [];
let cachedUnified = [];
let hrMap = new Map();

// Cờ khóa luồng (Mutex Lock)
let isSyncing = false;

// --- MOCK DATA TẠO THÔNG TIN BỔ SUNG ---
const ENRICHMENT_MAP = {
    depts: ['Engineering', 'Sales', 'Marketing', 'Finance', 'HR'],
    ethnicities: ['Asian', 'Caucasian', 'Hispanic', 'African American'],
    empTypes: ['Full-time', 'Part-time'],
    benefitPlans: ['Standard Health', 'Premium Gold', 'Dental Basic']
};

function generateMockData(name) {
    let hash = 0; for (let i = 0; i < name.length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash);
    hash = Math.abs(hash);
    return {
        department: ENRICHMENT_MAP.depts[hash % ENRICHMENT_MAP.depts.length],
        ethnicity: ENRICHMENT_MAP.ethnicities[hash % ENRICHMENT_MAP.ethnicities.length],
        empType: ENRICHMENT_MAP.empTypes[hash % ENRICHMENT_MAP.empTypes.length],
        benefitPlan: ENRICHMENT_MAP.benefitPlans[hash % ENRICHMENT_MAP.benefitPlans.length],
        benefitsCost: 100 + (hash % 400),
        isBirthdayMonth: (hash % 12 === new Date().getMonth()),
        isAnnivMonth: ((hash + 1) % 12 === new Date().getMonth()),
        hasBenefitChange: (hash % 10 === 0)
    };
}

// ==========================================
// CƠ CHẾ STREAMING ĐỌC/GHI
// ==========================================
async function streamWriteData(filename, dataArray) {
    return new Promise((resolve, reject) => {
        const stream = fs.createWriteStream(filename);
        stream.on('error', reject);
        stream.on('finish', resolve);
        for (let i = 0; i < dataArray.length; i++) {
            stream.write(JSON.stringify(dataArray[i]) + '\n');
        }
        stream.end();
    });
}

async function streamReadData(filename, targetArray) {
    if (!fs.existsSync(filename)) return;
    return new Promise((resolve) => {
        const fileStream = fs.createReadStream(filename);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
        rl.on('line', (line) => {
            if (line.trim()) targetArray.push(JSON.parse(line));
        });
        rl.on('close', resolve);
    });
}

async function writeCache() {
    console.log("⏳ Đang Stream xả dữ liệu khổng lồ xuống ổ cứng...");
    try {
        fs.writeFileSync(CACHE_META, JSON.stringify({ lastSync: new Date().toLocaleString() }));
        await streamWriteData(CACHE_HR, cachedHR);
        await streamWriteData(CACHE_PAYROLL, cachedPayroll);
        await streamWriteData(CACHE_UNIFIED, cachedUnified);
        console.log(`✅ [BFF] ĐÃ LƯU THÀNH CÔNG VĨNH VIỄN!`);
    } catch (e) {
        console.error("❌ Lỗi khi ghi Cache:", e);
    }
}

async function readCache() {
    console.log("⏳ Đang nạp hàng triệu bản ghi từ Ổ Cứng vào RAM. Vui lòng đợi...");
    try {
        await streamReadData(CACHE_HR, cachedHR);
        await streamReadData(CACHE_PAYROLL, cachedPayroll);
        await streamReadData(CACHE_UNIFIED, cachedUnified);
        return true;
    } catch (e) {
        console.error("❌ Lỗi đọc Cache:", e);
        return false;
    }
}

// =======================================================================
// [THÊM MỚI CHỨ KHÔNG BỚT] ĐỌC DỮ LIỆU TỪ POSTGRESQL KHI KHỞI ĐỘNG
// =======================================================================
async function loadFromDatabase() {
    try {
        const { rows } = await pool.query("SELECT * FROM employees ORDER BY id DESC");
        let count = 0;
        rows.forEach(dbEmp => {
            if (!cachedUnified.find(e => e.id == dbEmp.id)) {
                cachedUnified.unshift({
                    id: dbEmp.id,
                    name: `${dbEmp.first_name} ${dbEmp.last_name}`,
                    department: dbEmp.department,
                    gender: dbEmp.gender,
                    ethnicity: dbEmp.ethnicity,
                    empType: dbEmp.emp_type,
                    benefitPlan: dbEmp.benefit_plan,
                    shareholder: dbEmp.shareholder === '1' || dbEmp.shareholder === 'Yes' ? 'Yes' : 'No',
                    salaryYTD: parseFloat(dbEmp.salary_ytd) || 0,
                    vacationYTD: parseInt(dbEmp.vacation_days) || 0,
                    salaryPrev: (parseFloat(dbEmp.salary_ytd) || 0) * 0.9,
                    vacationPrev: Math.max(0, (parseInt(dbEmp.vacation_days) || 0) - 2),
                    source: 'both' 
                });
                count++;
            }
        });
        if (count > 0) console.log(`📥 [DB Sync] Đã nạp lại thành ${count} nhân sự mới hì hục nhập từ PostgreSQL vào RAM!`);
    } catch (e) {
        console.error("❌ Lỗi nạp dữ liệu từ CSDL PostgreSQL:", e.message);
    }
}

// ==========================================
// 1. MODULE ĐĂNG NHẬP PAYROLL
// ==========================================
async function getPayrollSession() {
    console.log("🔑 [Payroll] Đang khởi tạo phiên đăng nhập...");
    try {
        const formData = new URLSearchParams();
        formData.append('userName', 'tuanhuynh');
        formData.append('password', '123456');

        const loginRes = await fetch('http://localhost:8080/springapp/admin/login.html', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formData.toString(),
            redirect: 'manual'
        });

        if (loginRes.status === 302) {
            console.log("🔓 [Payroll] Xác thực THÀNH CÔNG! Đã lấy được Authenticated Cookie.");
            let sessionCookie = '';
            if (typeof loginRes.headers.getSetCookie === 'function') {
                sessionCookie = loginRes.headers.getSetCookie().map(c => c.split(';')[0]).join('; ');
            } else {
                const rawCookie = loginRes.headers.get('set-cookie');
                if (rawCookie) sessionCookie = rawCookie.split(';')[0];
            }
            return sessionCookie;
        } else {
            console.log(`❌ [Payroll] Đăng nhập thất bại (Mã HTTP: ${loginRes.status}).`);
            return null;
        }
    } catch (e) {
        console.error("❌ Lỗi kết nối máy chủ 8080:", e.message);
        return null;
    }
}

// =========================================================================
// 2. THUẬT TOÁN ĐỒNG BỘ: ĐỌC "THỰC TIỄN" TỪ GIAO DIỆN (HEAD & TAIL)
// =========================================================================
async function syncFromLegacy(forceScrapeAll = false) {
    if (isSyncing) return;
    isSyncing = true;

    try {
        console.log("\n🔄 BẮT ĐẦU ĐỒNG BỘ (ĐỌC THỰC TIỄN TỪ GIAO DIỆN)...");
        let hrNewCount = 0;
        let prNewCount = 0;

        // ==========================================
        // CÀO HR SYSTEM
        // ==========================================
        hrMap.clear();
        cachedHR.forEach(emp => hrMap.set(emp.name.toLowerCase(), emp));

        console.log(`⏳ [HR] Truy cập Trang 1 để đọc dữ liệu và kiểm tra mốc trang cuối...`);
        let hrLastPage = 1;
        
        try {
            const res = await fetch(`http://localhost:19335/Personals?page=1`);
            const html = await res.text();
            const $ = cheerio.load(html);
            
            // 👉 ĐỌC THỰC TIỄN: Dùng Regex tìm chữ kiểu "Trang 1 / 9431"
            const match = $('body').text().match(/(\d+)\s*\/\s*(\d+)/);
            if (match && match[2]) {
                hrLastPage = parseInt(match[2], 10);
            }
            
            // Xử lý dữ liệu lấy được ở Trang 1
            $('table tr').each((idx, el) => {
                if (idx === 0 || $(el).find('th').length > 0) return;
                const tds = $(el).find('td');
                if (tds.length >= 6) {
                    const name = $(tds[0]).text().trim();
                    if (name && !hrMap.has(name.toLowerCase())) {
                        const emp = { name, city: $(tds[1]).text().trim(), email: $(tds[2]).text().trim(), phone: $(tds[3]).text().trim(), gender: $(tds[4]).text().trim(), shareholder: $(tds[5]).text().trim() };
                        cachedHR.push(emp); hrMap.set(name.toLowerCase(), emp); hrNewCount++;
                    }
                }
            });
        } catch(e) { console.error("Lỗi cào HR Trang 1:", e.message); }

        // Bày binh bố trận các trang cần vét (2, kề cuối, cuối)
        const hrPagesToScrape = new Set([2, hrLastPage > 1 ? hrLastPage - 1 : 1, hrLastPage]);
        hrPagesToScrape.delete(1); // Xóa trang 1 vì cào rồi
        const hrTargets = Array.from(hrPagesToScrape).filter(p => p > 1).sort((a, b) => a - b);

        if (hrTargets.length > 0) {
            console.log(`🎯 [HR] Trang cuối thực tế là ${hrLastPage}. Các trang vét nốt: [${hrTargets.join(', ')}]`);
            const hrPromises = hrTargets.map(page => 
                fetch(`http://localhost:19335/Personals?page=${page}`)
                    .then(res => res.text()).then(html => {
                        const $ = cheerio.load(html);
                        $('table tr').each((idx, el) => {
                            if (idx === 0 || $(el).find('th').length > 0) return;
                            const tds = $(el).find('td');
                            if (tds.length >= 6) {
                                const name = $(tds[0]).text().trim();
                                if (name && !hrMap.has(name.toLowerCase())) {
                                    const emp = { name, city: $(tds[1]).text().trim(), email: $(tds[2]).text().trim(), phone: $(tds[3]).text().trim(), gender: $(tds[4]).text().trim(), shareholder: $(tds[5]).text().trim() };
                                    cachedHR.push(emp); hrMap.set(name.toLowerCase(), emp); hrNewCount++;
                                }
                            }
                        });
                    }).catch(e => 0)
            );
            await Promise.all(hrPromises);
        }
        if (hrNewCount > 0) console.log(`✅ [HR] Vừa vét thêm được ${hrNewCount} records mới! Tổng: ${cachedHR.length}`);

        // ==========================================
        // CÀO PAYROLL SYSTEM
        // ==========================================
        const payrollMap = new Map();
        cachedPayroll.forEach(emp => payrollMap.set(emp.empNumber, emp));
        const sessionCookie = await getPayrollSession();

        if (sessionCookie) {
            console.log(`⏳ [Payroll] Truy cập Trang 1 để đọc dữ liệu và kiểm tra mốc trang cuối...`);
            let prLastPage = 1;

            try {
                const res = await fetch(`http://localhost:8080/springapp/admin/employee/list.html?page=1`, { headers: { 'Cookie': sessionCookie }, redirect: 'follow' });
                const html = await res.text();
                const $ = cheerio.load(html);
                
                if ($('input[name="userName"]').length === 0) { // Nếu không bị văng ra Login
                    // 👉 ĐỌC THỰC TIỄN: Dùng Regex tìm chữ kiểu "Trang 1 / 10901"
                    const match = $('body').text().match(/(\d+)\s*\/\s*(\d+)/);
                    if (match && match[2]) {
                        prLastPage = parseInt(match[2], 10);
                    }

                    $('table tr').each((idx, el) => {
                        if (idx === 0 || $(el).find('th').length > 0) return;
                        const tds = $(el).find('td');
                        if (tds.length >= 5) {
                            const empNum = $(tds[0]).text().trim();
                            const name = $(tds[1]).text().trim();
                            if (empNum && !payrollMap.has(empNum)) {
                                cachedPayroll.push({ empNumber: empNum, name: name, ssn: $(tds[2]).text().trim(), salaryStr: $(tds[3]).text().trim(), vacationStr: $(tds[4]).text().trim() });
                                payrollMap.set(empNum, true); prNewCount++;
                            }
                        }
                    });
                }
            } catch(e) { console.error("Lỗi cào Payroll Trang 1:", e.message); }

            const prPagesToScrape = new Set([2, prLastPage > 1 ? prLastPage - 1 : 1, prLastPage]);
            prPagesToScrape.delete(1);
            const prTargets = Array.from(prPagesToScrape).filter(p => p > 1).sort((a, b) => a - b);

            if (prTargets.length > 0) {
                console.log(`🎯 [Payroll] Trang cuối thực tế là ${prLastPage}. Các trang vét nốt: [${prTargets.join(', ')}]`);
                const prPromises = prTargets.map(page => 
                    fetch(`http://localhost:8080/springapp/admin/employee/list.html?page=${page}`, { headers: { 'Cookie': sessionCookie }, redirect: 'follow' })
                        .then(res => res.text()).then(html => {
                            const $ = cheerio.load(html);
                            if ($('input[name="userName"]').length > 0) return 0;
                            $('table tr').each((idx, el) => {
                                if (idx === 0 || $(el).find('th').length > 0) return;
                                const tds = $(el).find('td');
                                if (tds.length >= 5) {
                                    const empNum = $(tds[0]).text().trim();
                                    const name = $(tds[1]).text().trim();
                                    if (empNum && !payrollMap.has(empNum)) {
                                        cachedPayroll.push({ empNumber: empNum, name: name, ssn: $(tds[2]).text().trim(), salaryStr: $(tds[3]).text().trim(), vacationStr: $(tds[4]).text().trim() });
                                        payrollMap.set(empNum, true); prNewCount++;
                                    }
                                }
                            });
                        }).catch(e => 0)
                );
                await Promise.all(prPromises);
            }
            if (prNewCount > 0) console.log(`✅ [Payroll] Vừa vét thêm được ${prNewCount} records mới! Tổng: ${cachedPayroll.length}`);
        }

        // ==========================================
        // GỘP DỮ LIỆU & LỌC TRÙNG VỚI DB (UNIFIED)
        // ==========================================
        if (hrNewCount > 0 || prNewCount > 0) {
            console.log("⚙️ Có dữ liệu mới! Đang gộp Unified List...");
            let tempUnified = [];
            const manuallyAdded = cachedUnified.filter(e => typeof e.id === 'number');
            const manualIds = new Set(manuallyAdded.map(e => String(e.id)));
            const manualNames = new Set(manuallyAdded.map(e => e.name.toLowerCase()));

            cachedPayroll.forEach(pEmp => {
                if (manualIds.has(String(pEmp.empNumber))) return; 

                const key = pEmp.name.toLowerCase();
                const hr = hrMap.get(key);

                let salNum = parseFloat(pEmp.salaryStr.replace(/[^0-9.]/g, "")) || (pEmp.salaryStr.includes('Hourly') ? 15 : 0);
                let vacNum = parseInt(pEmp.vacationStr) || 0;
                const mock = generateMockData(pEmp.name);

                tempUnified.push({
                    id: pEmp.empNumber, name: pEmp.name,
                    email: hr ? hr.email : '---', phone: hr ? hr.phone : '---',
                    department: mock.department, empType: mock.empType, benefitPlan: mock.benefitPlan,
                    ethnicity: mock.ethnicity,
                    gender: hr ? hr.gender : (mock.department.length % 2 === 0 ? 'Male' : 'Female'),
                    shareholder: hr ? (hr.shareholder.includes('1') ? 'Yes' : 'No') : 'No',
                    salaryYTD: salNum * 12, salaryPrev: salNum * 11,
                    vacationYTD: vacNum, vacationPrev: Math.max(0, vacNum - 2),
                    salaryOrig: pEmp.salaryStr, vacationOrig: pEmp.vacationStr,
                    source: hr ? 'both' : 'payroll',
                    ...mock
                });
                if (hr) hrMap.delete(key);
            });

            hrMap.forEach(hEmp => {
                if (manualNames.has(hEmp.name.toLowerCase())) return; 

                const mock = generateMockData(hEmp.name);
                tempUnified.push({
                    id: '---', name: hEmp.name, email: hEmp.email, phone: hEmp.phone,
                    department: mock.department, empType: mock.empType, benefitPlan: mock.benefitPlan,
                    ethnicity: mock.ethnicity,
                    gender: hEmp.gender, shareholder: hEmp.shareholder.includes('1') ? 'Yes' : 'No',
                    salaryYTD: 0, salaryPrev: 0, vacationYTD: 0, vacationPrev: 0,
                    salaryOrig: '---', vacationOrig: '0',
                    source: 'hr',
                    ...mock
                });
            });

            tempUnified.sort((a, b) => {
                const rankA = a.source === 'both' ? 1 : (a.source === 'payroll' ? 2 : 3);
                const rankB = b.source === 'both' ? 1 : (b.source === 'payroll' ? 2 : 3);
                return rankA - rankB;
            });

            cachedUnified = [...manuallyAdded, ...tempUnified];
            console.log(`🎯 Cập nhật Unified List thành công! Tổng cộng: ${cachedUnified.length} records.`);
            await writeCache();
        } else {
            console.log(`✅ [Đồng bộ] Hệ thống an toàn, không có dữ liệu chênh lệch.`);
        }

    } catch (err) {
        console.error("❌ Có lỗi trong quá trình đồng bộ:", err);
    } finally {
        isSyncing = false;
    }
}

// =========================================================================
// [NEW - CHUẨN ENTERPRISE] API SINGLE SOURCE OF ENTRY
// =========================================================================
app.post('/api/employees', async (req, res) => {
    const client = await pool.connect();
    try {
        const empData = req.body;
        const fullName = `${empData.firstName} ${empData.lastName}`;

        // 1. Mở ACID Transaction để đảm bảo tính Nhất quán (Consistency)
        await client.query('BEGIN');

        // 2. CHÈN VÀO DATABASE VỚI ĐẦY ĐỦ CÁC CỘT (CHUẨN 100%)
        const insertEmp = `
            INSERT INTO employees (
                first_name, last_name, ssn, gender, ethnicity, 
                department, emp_type, shareholder, benefit_plan, 
                salary_ytd, vacation_days
            ) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
            RETURNING id`;
            
        const empResult = await client.query(insertEmp, [
            empData.firstName, 
            empData.lastName, 
            empData.ssn, 
            empData.gender, 
            empData.ethnicity, 
            empData.department, 
            empData.empType, 
            empData.shareholder, 
            empData.benefitPlan, 
            empData.salaryYTD, 
            empData.vacationYTD
        ]);
        const newEmpId = empResult.rows[0].id;

        // 3. Ghi Outbox để con Worker bốc ném lên RabbitMQ an toàn
        const eventPayload = JSON.stringify({ action: 'CREATE', data: { id: newEmpId, fullName: fullName, ...empData } });
        await client.query(`INSERT INTO outbox_events (aggregate_type, payload) VALUES ('EMPLOYEE', $1)`, [eventPayload]);

        // 4. Chốt Transaction
        await client.query('COMMIT');

        // BƠM VÀO CACHE RAM ĐỂ HIỂN THỊ TỨC THÌ (FULL DATA CHO UI)
        cachedUnified.unshift({
            id: newEmpId, 
            name: fullName, 
            department: empData.department, 
            gender: empData.gender,
            ethnicity: empData.ethnicity, 
            empType: empData.empType, 
            benefitPlan: empData.benefitPlan, 
            shareholder: empData.shareholder,
            salaryYTD: empData.salaryYTD, 
            vacationYTD: empData.vacationYTD,
            salaryPrev: empData.salaryYTD * 0.9,
            vacationPrev: Math.max(0, empData.vacationYTD - 2),
            source: 'both' // Đánh dấu 'both' để nó tự xếp ưu tiên cao nhất
        });

        res.status(201).json({ success: true, message: 'Lưu thành công. Dữ liệu đã ghi vào CSDL Chính và đang đồng bộ ngầm sang HR & Payroll.' });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Lỗi khi Single Entry:', err);
        res.status(500).json({ error: 'Giao dịch CSDL thất bại, đã rollback.' });
    } finally {
        client.release();
    }
});


// ==========================================
// 3. API ĐỊNH TUYẾN (Dashboard Stats)
// ==========================================

app.get('/api/sync', async (req, res) => {
    syncFromLegacy(req.query.force === 'true');
    res.json({ success: true, message: "Tiến trình đồng bộ đang chạy ngầm!" });
});

app.get('/api/dashboard/stats', (req, res) => {
    const totalEarnings = cachedUnified.reduce((sum, e) => sum + (e.salaryYTD || 0), 0);
    const totalVacation = cachedUnified.reduce((sum, e) => sum + (e.vacationYTD || 0), 0);

    res.json({
        totalHR: cachedHR.length,
        totalPayroll: cachedPayroll.length,
        totalUnified: cachedUnified.length,
        totalEarnings: totalEarnings, 
        totalVacation: totalVacation, 
        alerts: {
            birthday: cachedUnified.filter(e => e.isBirthdayMonth).length,
            anniversary: cachedUnified.filter(e => e.isAnnivMonth).length,
            vacation: cachedUnified.filter(e => e.vacationYTD > 15).length,
            benefits: cachedUnified.filter(e => e.hasBenefitChange).length
        }
    });
});

app.get('/api/dashboard/charts', (req, res) => {
    const safeDataForCharts = cachedUnified.slice(0, 15000);
    res.json(safeDataForCharts);
});

// =========================================================================
// THUẬT TOÁN TÌM KIẾM MỚI (FUZZY SEARCH NHƯ GOOGLE)
// =========================================================================
app.get('/api/employees/:mode', (req, res) => {
    const { mode } = req.params;
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const filter = req.query.filter || 'all';
    const searchParam = (req.query.search || '').toLowerCase().trim();

    let targetData = mode === 'hr' ? cachedHR : (mode === 'payroll' ? cachedPayroll : cachedUnified);

    // 1. Lọc theo Menu (CEO Alerts)
    if (mode === 'unified' && filter !== 'all') {
        if (filter === 'birthday') targetData = targetData.filter(d => d.isBirthdayMonth);
        if (filter === 'anniversary') targetData = targetData.filter(d => d.isAnnivMonth);
        if (filter === 'vacation') targetData = targetData.filter(d => d.vacationYTD > 15);
        if (filter === 'benefits') targetData = targetData.filter(d => d.hasBenefitChange);
    }

    // 2. Lọc theo Tên (Global Search) - Cập nhật logic tìm kiếm mờ (Fuzzy Search)
    if (searchParam) {
        // Tách chuỗi người dùng nhập thành mảng các từ khóa (loại bỏ khoảng trắng thừa)
        const searchTerms = searchParam.split(/\s+/); 
        
        targetData = targetData.filter(d => {
            // Gộp tất cả các thông tin cần tìm vào 1 chuỗi
            const searchableText = `${d.name || ''} ${d.empNumber || ''} ${d.id || ''}`.toLowerCase();
            
            // Record chỉ hiển thị khi chuỗi đó chứa TẤT CẢ các từ khóa nhập vào (không phân biệt thứ tự)
            return searchTerms.every(term => searchableText.includes(term));
        });
    }

    const startIndex = (page - 1) * limit;
    res.json({
        data: targetData.slice(startIndex, startIndex + limit),
        pagination: { totalItems: targetData.length, totalPages: Math.ceil(targetData.length / limit) || 1, currentPage: page }
    });
});


// =========================================================================
// [NEW] BACKGROUND WORKER BẮN OUTBOX LÊN RABBITMQ (Relay Service)
// =========================================================================
async function relayOutboxEvents() {
    try {
        const connection = await amqp.connect('amqp://localhost');
        const channel = await connection.createChannel();
        await channel.assertExchange('employee_sync_exchange', 'fanout', { durable: true });
        console.log("🐰 Khởi động RabbitMQ Relay thành công.");

        setInterval(async () => {
            try {
                // Quét event đang chờ
                const { rows } = await pool.query("SELECT * FROM outbox_events WHERE status = 'PENDING' LIMIT 50");
                for (const event of rows) {
                    // Bắn lên Exchange để rẽ nhánh cho 2 hệ thống cũ
                    channel.publish('employee_sync_exchange', '', Buffer.from(JSON.stringify(event.payload)));
                    // Update trạng thái
                    await pool.query("UPDATE outbox_events SET status = 'PROCESSED' WHERE id = $1", [event.id]);
                }
            } catch (e) {
                console.error("Lỗi loop quét Outbox:", e);
            }
        }, 3000); 

    } catch (err) {
        console.log("Cảnh báo: Chưa bật RabbitMQ local ở cổng 5672", err.message);
    }
}


// ==========================================
// 4. KHỞI ĐỘNG SERVER
// ==========================================
async function bootServer() {
    console.log(`\n======================================================`);
    console.log('🚀 Khởi động Hệ thống BFF...');

    // Test kết nối PG
    pool.query('SELECT NOW()', (err, res) => {
        if (err) console.error('❌ Lỗi kết nối PostgreSQL. Hãy kiểm tra db của bạn!', err.message);
        else console.log('🐘 PostgreSQL đã sẵn sàng.');
    });

    if (fs.existsSync(CACHE_META)) {
        await readCache();
        console.log(`📂 Đã nạp thành công: HR (${cachedHR.length}), Payroll (${cachedPayroll.length}), Unified (${cachedUnified.length})`);
    }

    // [THÊM MỚI] Đọc lại từ CSDL ngay sau khi load file rác, dữ liệu sếp gõ không bao giờ bay mất
    await loadFromDatabase();

    app.listen(3000, () => {
        console.log(`\n======================================================`);
        console.log(`🟢 GIAO DIỆN ĐÃ SẴN SÀNG!`);
        console.log(`👉 Giữ phím CTRL (hoặc CMD) và Click vào link này để mở: \x1b[36mhttp://localhost:3000\x1b[0m`);
        console.log(`======================================================\n`);
        
        relayOutboxEvents(); // Bật tác vụ ngầm chạy Message Queue

        console.log("⏱️ Kích hoạt Robot quét Head & Thực tiễn Tail mỗi 30s...");
        setInterval(() => {
            syncFromLegacy(false); 
        }, 30000); 
        
        setTimeout(() => syncFromLegacy(false), 2000);
    });
}

bootServer();