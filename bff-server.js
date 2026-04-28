const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const fs = require('fs');
const readline = require('readline'); 

const app = express();
app.use(cors());

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

// ==========================================
// 2. THUẬT TOÁN CÀO & GỘP DATA
// ==========================================
async function syncFromLegacy(forceScrapeAll = false) {
    if (isSyncing) {
        console.log("⚠️ Hệ thống đang bận đồng bộ. Bỏ qua lệnh mới...");
        return;
    }
    isSyncing = true;
    
    try {
        console.log("\n🔄 BẮT ĐẦU ĐỒNG BỘ DỮ LIỆU TỪ CÁC HỆ THỐNG CŨ...");
        let tempUnified = []; 
        hrMap.clear();

        // --- CÀO HR SYSTEM ---
        if (cachedHR.length >= 900000 && !forceScrapeAll) {
            console.log(`⏭️ [HR System] Đã có đủ data. BỎ QUA!`);
            cachedHR.forEach(emp => hrMap.set(emp.name.toLowerCase(), emp));
        } else {
            let hrPage = 1;
            if (cachedHR.length > 0) {
                hrPage = Math.floor(cachedHR.length / 100) + 1;
                console.log(`⏩ [HR System] Chế độ RESUME: Đang có sẵn ${cachedHR.length} records. KHÔNG XÓA.`);
                console.log(`⏩ [HR System] Bắt đầu cào NỐI TIẾP từ trang ${hrPage}...`);
                cachedHR.forEach(emp => hrMap.set(emp.name.toLowerCase(), emp));
            } else {
                console.log(`⏳ [HR System] Cào dữ liệu từ con số 0...`);
                cachedHR = [];
            }

            let hrHasMore = true;
            let batchCounter = 0; 

            while (hrHasMore) {
                const promises = [];
                for (let i = 0; i < 50; i++) {
                    promises.push(
                        fetch(`http://localhost:19335/Personals?page=${hrPage + i}`)
                            .then(res => res.text())
                            .then(html => {
                                const $ = cheerio.load(html);
                                let itemsCount = 0;
                                $('table tr').each((idx, el) => {
                                    if (idx === 0 || $(el).find('th').length > 0) return;
                                    const tds = $(el).find('td');
                                    if (tds.length >= 6) {
                                        const name = $(tds[0]).text().trim();
                                        if (name) {
                                            const emp = {
                                                name, city: $(tds[1]).text().trim(),
                                                email: $(tds[2]).text().trim(), phone: $(tds[3]).text().trim(),
                                                gender: $(tds[4]).text().trim(), shareholder: $(tds[5]).text().trim()
                                            };
                                            cachedHR.push(emp);
                                            hrMap.set(name.toLowerCase(), emp);
                                            itemsCount++;
                                        }
                                    }
                                });
                                return itemsCount;
                            }).catch(e => 0)
                    );
                }
                const results = await Promise.all(promises);
                const batchTotal = results.reduce((a, b) => a + b, 0);
                console.log(`⏳ [HR] Đang quét... tổng gom được: ${cachedHR.length} records`);
                hrPage += 50;
                batchCounter++;
                
                if (batchTotal === 0) hrHasMore = false; 

                if (batchCounter % 10 === 0) {
                    console.log(`💾 Auto-save: Đang sao lưu an toàn ${cachedHR.length} HR records xuống ổ cứng...`);
                    await streamWriteData(CACHE_HR, cachedHR);
                }
            }
            console.log(`✅ HOÀN THÀNH HR: ${cachedHR.length} nhân sự.\n`);
        }

        // --- CÀO PAYROLL SYSTEM ---
        if (cachedPayroll.length > 0) {
            console.log(`⏭️ [Payroll System] Đã có ${cachedPayroll.length} records. BỎ QUA cào lại!`);
        } else {
            console.log(`⏳ [Payroll System] Bắt đầu cào dữ liệu mới...`);
            cachedPayroll = []; 
            const sessionCookie = await getPayrollSession();
            let prPage = 1; let prHasMore = true;

            while (prHasMore && sessionCookie) {
                const promises = [];
                for (let i = 0; i < 50; i++) {
                    promises.push(
                        fetch(`http://localhost:8080/springapp/admin/employee/list.html?page=${prPage + i}`, {
                            headers: { 'Cookie': sessionCookie },
                            redirect: 'follow'
                        })
                        .then(res => {
                            if (res.url.includes('login.html')) throw new Error('Session Expired');
                            return res.text();
                        })
                        .then(html => {
                            const $ = cheerio.load(html);
                            if ($('input[name="userName"]').length > 0) return 0;

                            let itemsCount = 0;
                            $('table tr').each((idx, el) => {
                                if (idx === 0 || $(el).find('th').length > 0) return;
                                const tds = $(el).find('td');
                                if (tds.length >= 5) {
                                    const name = $(tds[1]).text().trim();
                                    if (name) {
                                        cachedPayroll.push({
                                            empNumber: $(tds[0]).text().trim(), name: name,
                                            ssn: $(tds[2]).text().trim(), salaryStr: $(tds[3]).text().trim(),
                                            vacationStr: $(tds[4]).text().trim()
                                        });
                                        itemsCount++;
                                    }
                                }
                            });
                            return itemsCount;
                        }).catch(e => 0)
                    );
                }
                const results = await Promise.all(promises);
                const batchTotal = results.reduce((a, b) => a + b, 0);
                console.log(`⏳ [Payroll] Đang quét... gom được: ${cachedPayroll.length} records`);
                prPage += 50;
                if (batchTotal === 0) prHasMore = false; 
            }
            console.log(`✅ HOÀN THÀNH PAYROLL: ${cachedPayroll.length} nhân sự.\n`);
        }

        // --- GỘP DỮ LIỆU & SẮP XẾP ---
        console.log("⚙️ Đang thực hiện gộp dữ liệu và sắp xếp độ ưu tiên...");
        cachedPayroll.forEach(pEmp => {
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
            if(hr) hrMap.delete(key); 
        });

        hrMap.forEach(hEmp => {
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

        // SẮP XẾP ĐỘ ƯU TIÊN (Both -> Payroll -> HR)
        tempUnified.sort((a, b) => {
            const rankA = a.source === 'both' ? 1 : (a.source === 'payroll' ? 2 : 3);
            const rankB = b.source === 'both' ? 1 : (b.source === 'payroll' ? 2 : 3);
            return rankA - rankB;
        });

        cachedUnified = tempUnified;
        console.log(`🎯 TẤT CẢ ĐÃ SẴN SÀNG! Unified List có tổng cộng: ${cachedUnified.length} records.`);
        
        await writeCache(); 
        
    } catch (err) {
        console.error("❌ Có lỗi trong quá trình đồng bộ:", err);
    } finally {
        isSyncing = false; 
    }
}

// ==========================================
// 3. API ĐỊNH TUYẾN (ĐÃ BỔ SUNG TÍNH TỔNG SỐ)
// ==========================================

app.get('/api/sync', async (req, res) => {
    syncFromLegacy(req.query.force === 'true');
    res.json({ success: true, message: "Tiến trình đồng bộ đang chạy ngầm!" });
});

app.get('/api/dashboard/stats', (req, res) => {
    // TÍNH TỔNG SỐ THEO YÊU CẦU: Tổng quỹ lương YTD và Tổng ngày nghỉ phép
    const totalEarnings = cachedUnified.reduce((sum, e) => sum + (e.salaryYTD || 0), 0);
    const totalVacation = cachedUnified.reduce((sum, e) => sum + (e.vacationYTD || 0), 0);

    res.json({
        totalHR: cachedHR.length, 
        totalPayroll: cachedPayroll.length, 
        totalUnified: cachedUnified.length,
        totalEarnings: totalEarnings, // Gửi Tổng thu nhập xuống Frontend
        totalVacation: totalVacation, // Gửi Tổng ngày phép xuống Frontend
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

    // 2. Lọc theo Tên (Global Search)
    if (searchParam) {
        targetData = targetData.filter(d => 
            (d.name && d.name.toLowerCase().includes(searchParam)) ||
            (d.empNumber && d.empNumber.toLowerCase().includes(searchParam))
        );
    }
    
    const startIndex = (page - 1) * limit;
    res.json({
        data: targetData.slice(startIndex, startIndex + limit),
        pagination: { totalItems: targetData.length, totalPages: Math.ceil(targetData.length / limit) || 1, currentPage: page }
    });
});

// ==========================================
// 4. KHỞI ĐỘNG SERVER
// ==========================================
async function bootServer() {
    console.log(`===========================================`);
    console.log('🚀 Khởi động Hệ thống BFF...');
    
    if (fs.existsSync(CACHE_META)) {
        await readCache();
        console.log(`📂 Đã nạp thành công: HR (${cachedHR.length}), Payroll (${cachedPayroll.length}), Unified (${cachedUnified.length})`);
    }

    app.listen(3000, () => {
        console.log(`🟢 BFF Server đang chạy tại http://localhost:3000`);
    });
}

bootServer();