const amqp = require('amqplib');
const sql = require('mssql');       // Driver cho SQL Server (HR)
const mysql = require('mysql2/promise'); // Driver cho MySQL (Payroll)

// =========================================================================
// 1. CẤU HÌNH KẾT NỐI DATABASE CỦA HỆ THỐNG CŨ
// =========================================================================
const hrDbConfig = {
    user: 'sa',
    password: 'a123456*', // 👉 SỬA LẠI PASS SQL SERVER CỦA BẠN NẾU KHÁC
    server: 'localhost', 
    database: 'HR',
    port: 1433,
    options: { encrypt: false, trustServerCertificate: true }
};

const payrollDbConfig = {
    host: 'localhost',
    user: 'root',
    password: '', // 👉 SỬA LẠI PASS MYSQL CỦA BẠN NẾU CÓ
    database: 'payroll'
};

// =========================================================================
// 2. TIẾN TRÌNH WORKER (BẢN FIX LỖI KHÓA NGOẠI HR)
// =========================================================================
async function startLegacySyncWorker() {
    try {
        const connection = await amqp.connect('amqp://localhost');
        const channel = await connection.createChannel();
        await channel.assertExchange('employee_sync_exchange', 'fanout', { durable: true });

        // Tạo Queue v4 để bỏ qua mọi rác từ các tin nhắn lỗi trước đó
        const qHR = await channel.assertQueue('hr_legacy_queue_v4', { durable: true });
        const qPR = await channel.assertQueue('payroll_legacy_queue_v4', { durable: true });

        await channel.bindQueue(qHR.queue, 'employee_sync_exchange', '');
        await channel.bindQueue(qPR.queue, 'employee_sync_exchange', '');

        console.log("👷 Các thợ xây (Worker) đã sẵn sàng. Đang chờ dữ liệu từ Dashboard...");

        // ---------------------------------------------------------------------
        // WORKER 1: HR 
        // ---------------------------------------------------------------------
        channel.consume(qHR.queue, async (msg) => {
            if (msg !== null) {
                const data = JSON.parse(msg.content.toString()).data;
                console.log(`\n🏥 [HR WORKER] Đang ghi vào SQL Server cho: ${data.fullName}`);
                
                let pool; 
                try {
                    pool = await sql.connect(hrDbConfig);
                    
                    // 👉 BƯỚC 1: LẤY ID HỢP LỆ TỪ BẢNG BENEFIT_PLANS (TRÁNH LỖI FOREIGN KEY)
                    const planResult = await pool.request().query('SELECT TOP 1 Benefit_Plan_ID FROM Benefit_Plans');
                    let validBenefitPlanId = null;
                    if (planResult.recordset.length > 0) {
                        validBenefitPlanId = planResult.recordset[0].Benefit_Plan_ID;
                    } else {
                        // Nếu DB trống trơn, tự động tạo 1 Plan mặc định để xài tạm
                        console.log('⚠️ Không tìm thấy Benefit Plan nào, tự động tạo Plan mặc định...');
                        await pool.request().query(`INSERT INTO Benefit_Plans (Plan_Name) VALUES ('Default Plan')`);
                        const newPlan = await pool.request().query('SELECT TOP 1 Benefit_Plan_ID FROM Benefit_Plans');
                        validBenefitPlanId = newPlan.recordset[0].Benefit_Plan_ID;
                    }

                    // BƯỚC 2: CHUẨN BỊ DỮ LIỆU
                    let defaultCity = data.city || 'Chưa cập nhật';
                    let defaultPhone = data.phone || 'N/A';
                    let defaultEmail = data.email || `${data.firstName.toLowerCase()}@acmecorp.com`;

                    // BƯỚC 3: INSERT VÀO PERSONAL VỚI ID CHUẨN
                    await pool.request()
                        .input('emp_id', sql.Numeric, data.id)
                        .input('fname', sql.VarChar, data.firstName)
                        .input('lname', sql.VarChar, data.lastName)
                        .input('ssn', sql.VarChar, data.ssn)
                        .input('gender', sql.Bit, data.gender === 'Male' ? 1 : 0)
                        .input('ethnicity', sql.VarChar, data.ethnicity || 'Unknown')
                        .input('shareholder', sql.Bit, data.shareholder === 'Yes' ? 1 : 0)
                        .input('city', sql.VarChar, defaultCity)
                        .input('email', sql.VarChar, defaultEmail)
                        .input('phone', sql.VarChar, defaultPhone)
                        .input('benefit_plan', sql.Numeric, validBenefitPlanId) // Dùng biến ID chuẩn ở đây
                        .query(`
                            INSERT INTO Personal (
                                Employee_ID, First_Name, Last_Name, Social_Security_Number, 
                                Gender, Ethnicity, Shareholder_Status, City, Email, 
                                Phone_Number, Benefit_Plans
                            )
                            VALUES (
                                @emp_id, @fname, @lname, @ssn, 
                                @gender, @ethnicity, @shareholder, @city, @email, 
                                @phone, @benefit_plan
                            )
                        `);
                    
                    console.log(`✅ [HR WORKER] THÀNH CÔNG! Đã lưu ${data.fullName} vào HR.`);
                    channel.ack(msg);

                } catch (e) {
                    console.error(`❌ [HR LỖI]`, e.message);
                    // channel.nack(msg); // Nếu muốn cho RabbitMQ chạy lại tin nhắn lỗi
                } finally {
                    if (pool) {
                        sql.close(); 
                    }
                }
            }
        });

        // ---------------------------------------------------------------------
        // WORKER 2: PAYROLL 
        // ---------------------------------------------------------------------
        channel.consume(qPR.queue, async (msg) => {
            if (msg !== null) {
                const data = JSON.parse(msg.content.toString()).data;
                console.log(`\n💰 [PAYROLL WORKER] Đang ghi vào MySQL cho: ${data.fullName}`);
                
                let mysqlConn;
                try {
                    mysqlConn = await mysql.createConnection(payrollDbConfig);
                    
                    const [rates] = await mysqlConn.execute('SELECT idPay_Rates, Pay_Rate_Name FROM pay_rates LIMIT 1');
                    let validPayRateId = rates.length > 0 ? rates[0].idPay_Rates : 1;
                    let validPayRateStr = rates.length > 0 ? rates[0].Pay_Rate_Name : '3.0'; 
                    
                    const ssnNumber = parseInt(data.ssn.replace(/-/g, '')) || 0;
                    let safeSalary = data.salaryYTD;
                    if (safeSalary > 99) safeSalary = 99; 

                    await mysqlConn.execute(
                        `INSERT INTO employee (Employee_Number, idEmployee, First_Name, Last_Name, SSN, Paid_To_Date, Vacation_Days, PayRates_id, Pay_Rate) 
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [data.id, data.id, data.firstName, data.lastName, ssnNumber, safeSalary, data.vacationYTD, validPayRateId, validPayRateStr]
                    );

                    console.log(`✅ [PAYROLL WORKER] THÀNH CÔNG! Đã lưu lương cho ${data.fullName} vào Payroll.`);
                    channel.ack(msg);

                } catch(e){
                    console.error(`❌ [PAYROLL LỖI]`, e.message);
                } finally {
                    if (mysqlConn) await mysqlConn.end();
                }
            }
        });

    } catch (error) {
        console.error("❌ Lỗi Khởi tạo Worker:", error);
    }
}

startLegacySyncWorker();