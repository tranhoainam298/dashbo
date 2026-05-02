-- 1. Tạo Database mới cho hệ thống tích hợp
CREATE DATABASE acme_corp_db;

-- LƯU Ý QUAN TRỌNG: Bạn phải chuyển kết nối vào database "acme_corp_db" vừa tạo 
-- trước khi bôi đen và chạy các lệnh CREATE TABLE dưới đây!

-- 2. Bảng lưu trữ dữ liệu gốc của nhân viên (Single Source of Truth)
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(255) NOT NULL,
    last_name VARCHAR(255) NOT NULL,
    ssn VARCHAR(50) NOT NULL,
    gender VARCHAR(50),
    ethnicity VARCHAR(100),
    department VARCHAR(100),
    emp_type VARCHAR(50),
    shareholder VARCHAR(10),
    benefit_plan VARCHAR(100),
    salary_ytd NUMERIC,
    vacation_days INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bảng quan trọng nhất: Hàng đợi sự kiện (Transactional Outbox Pattern)
CREATE TABLE outbox_events (
    id SERIAL PRIMARY KEY,
    aggregate_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    status VARCHAR(20) DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);