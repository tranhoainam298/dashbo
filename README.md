# 📊 Executive Unified Dashboard - Tích Hợp Hệ Thống (Case Study)

![Node.js](https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-404D59?style=for-the-badge)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)
![SQL Server](https://img.shields.io/badge/SQL_Server-CC2927?style=for-the-badge&logo=microsoft-sql-server&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-005C84?style=for-the-badge&logo=mysql&logoColor=white)
![RabbitMQ](https://img.shields.io/badge/RabbitMQ-FF6600?style=for-the-badge&logo=rabbitmq&logoColor=white)
![Vanilla JS](https://img.shields.io/badge/Vanilla_JS-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)

---

## 📑 Mục lục
1. [Tổng quan dự án](#-tổng-quan-dự-án)
2. [Kiến trúc hệ thống](#-kiến-trúc-hệ-thống)
3. [Tech Stack](#-tech-stack)
4. [Yêu cầu hệ thống](#-yêu-cầu-hệ-thống-prerequisites)
5. [Hướng dẫn cài đặt & Khởi chạy](#-hướng-dẫn-cài-đặt--khởi-chạy)
6. [Database Schema](#-database-schema)
7. [Tài liệu API](#-tài-liệu-api)
8. [Tính năng hệ thống](#-tính-năng-hệ-thống)
9. [Luồng hoạt động (Workflows)](#-luồng-hoạt-động-workflows)
10. [Tính toàn vẹn dữ liệu (ACID)](#-tính-toàn-vẹn-dữ-liệu--acid)
11. [Xử lý lỗi phổ biến (Troubleshooting)](#-xử-lý-lỗi-phổ-biến-troubleshooting)
12. [Q&A Bảo vệ đồ án](#-qa-bảo-vệ-đồ-án)
13. [Cấu trúc thư mục](#-cấu-trúc-thư-mục)
14. [Thông tin nhóm](#-thông-tin-nhóm)

---

## 🎯 Tổng quan dự án

Dự án **Executive Unified Dashboard** là giải pháp Tích hợp Hệ thống (System Integration) nhằm giải quyết bài toán phân mảnh dữ liệu giữa các hệ thống Legacy (HR và Payroll). 

> **CEO Memo Core Requirement:** *"Single Data Entry, distributed to other databases in near real-time."*

Hệ thống cung cấp một Dashboard duy nhất cho ban lãnh đạo (CEO) quản lý tổng thể. Khi có nhân sự mới, dữ liệu chỉ cần nhập **MỘT LẦN** tại Dashboard trung tâm, sau đó sẽ được tự động phân phối (Near Real-time) xuống 2 cơ sở dữ liệu cũ (SQL Server và MySQL) mà không làm gián đoạn hệ thống. Đồng thời, hệ thống liên tục cào (scrape) dữ liệu từ các web app cũ để đồng bộ ngược lại tạo thành một bức tranh toàn cảnh (Single Source of Truth).

---

## 🏗 Kiến trúc hệ thống
```mermaid
graph TD
    UI[CEO Dashboard UI] -->|1. POST| BFF(BFF Server Node.js)
    UI <-->|GET APIs| BFF
    
    subgraph SSOT [Single Source of Truth]
        BFF -->|2. ACID Transaction| PG[(PostgreSQL)]
        PG -->|Bang employees| PG
        PG -->|Bang outbox_events| PG
    end
    
    BFF -->|3. Background Relay| RMQ((RabbitMQ Exchange))
    
    RMQ -->|Queue: hr_legacy| W1(Worker 1)
    RMQ -->|Queue: payroll_legacy| W2(Worker 2)
    
    W1 -->|4a. INSERT| SQLS[(SQL Server - HR)]
    W2 -->|4b. INSERT| MY[(MySQL - Payroll)]
    
    subgraph Legacy [Legacy Systems]
        HR_Web[HR Web App]
        PR_Web[Payroll Web App]
    end
    
    BFF -->|5. Cronjob 30s| HR_Web
    BFF -->|5. Cronjob 30s| PR_Web
    HR_Web --> SQLS
    PR_Web --> MY
