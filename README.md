# 🚀 Executive Unified Dashboard - System Integration

![Node.js](https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white)
![Express.js](https://img.shields.io/badge/Express.js-000000?style=for-the-badge&logo=express&logoColor=white)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)
![Chart.js](https://img.shields.io/badge/Chart.js-FF6384?style=for-the-badge&logo=chartdotjs&logoColor=white)

Đồ án môn học **Tích hợp Hệ thống (System Integration)** - Giải quyết **Case Study & CEO Memo**. 
Dự án áp dụng mô hình tích hợp ở tầng giao diện (Presentation Integration) thông qua kiến trúc **BFF (Backend-For-Frontend)** để hợp nhất dữ liệu từ hai hệ thống Legacy (HR và Payroll) khổng lồ mà không can thiệp vào cơ sở dữ liệu gốc.

---

## ✨ Tính năng nổi bật (Key Features)

### 1. 🏗️ Kiến trúc BFF & Streaming Big Data
* **Web Scraping & Session Handling:** Tự động đăng nhập và cào (scrape) dữ liệu từ hệ thống HR (Port 19335) và hệ thống Payroll Spring MVC (Port 8080).
* **File Streaming (`.jsonl`):** Xử lý mượt mà dữ liệu bằng kỹ thuật đọc/ghi luồng (stream), giúp hệ thống không bị tràn RAM (Out of Memory).
* **Smart Sync (Auto-save & Resume):** Tự động lưu tiến trình cào dữ liệu và tiếp tục cào (resume) khi có sự cố ngắt kết nối.

### 2. 🧠 Gộp dữ liệu thông minh (Deduplication Logic)
* **Collision Detection:** Tự động phát hiện và xử lý trùng lặp nhân sự giữa 2 hệ thống dựa trên thuật toán chuẩn hóa tên (Normalized Name).
* **Source Indicator:** Phân loại và hiển thị minh bạch nguồn gốc dữ liệu trực quan trên giao diện (🏥 HR / 💰 Payroll / 🔗 Unified).
* Tự động gán cờ ưu tiên hiển thị (Both > Payroll > HR).

### 3. 📊 Executive Dashboard (Chuẩn CEO Memo)
* **KPI Tổng quan:** Hiển thị *Total Headcount* và *Total YTD Payroll*.
* **Manage by Exception (Drill-down Alerts):** 4 thẻ cảnh báo ngoại lệ (Sinh nhật, Kỷ niệm, Vượt phép, Đổi phúc lợi). Click vào thẻ sẽ tự động lọc (drill-down) danh sách tương ứng.
* **Dynamic Charts (Chart.js):** 3 biểu đồ phức tạp so sánh YTD vs Previous Year, hỗ trợ lọc động (Dropdown) đa chiều theo: Department, Gender, Ethnicity, Shareholder, Emp Type.

### 4. ⚡ Giao diện Tối ưu hiệu năng (UI/UX)
* **Global Search:** Tìm kiếm từ khóa trên toàn bộ 1.1 triệu bản ghi từ Server (có debounce delay 0.5s để chống spam request).
* **Server-side Pagination:** Phân trang từ phía Backend, đảm bảo giao diện web luôn mượt mà.
* **Sticky Layout:** Bảng dữ liệu có thanh tiêu đề và thanh phân trang cố định, không vỡ layout khi dữ liệu quá lớn.

---

## 🛠️ Công nghệ sử dụng

* **Backend:** Node.js, Express.js.
* **Data Parsing:** Cheerio (bóc tách HTML), fs/readline (xử lý luồng file).
* **Frontend:** HTML5, CSS3 thuần (Vanilla), JavaScript (ES6+).
* **Libraries:** Chart.js (Vẽ biểu đồ), FontAwesome (Icons), CORS.

---

## 📂 Cấu trúc thư mục (Project Structure)

```text
presentation_Integration/
├── bff-server.js        # Server Node.js đóng vai trò Aggregator & Scraper
├── app.js               # Logic điều khiển Frontend (Gọi API, Vẽ Chart)
├── index.html           # Giao diện Dashboard (HTML/CSS)
├── package.json         # Danh sách thư viện Dependencies
├── cache-meta.json      # (Auto-generated) Metadata lưu vết thời gian đồng bộ
└── cache-*.jsonl        # (Auto-generated) Database dạng JSON Lines cho Big Data
🚀 Hướng dẫn Cài đặt & Chạy dự án
Yêu cầu hệ thống:
Node.js (phiên bản 16.x trở lên).

Hệ thống Legacy HR (Port 19335) và Payroll (Port 8080) phải đang hoạt động.

Bước 1: Cài đặt thư viện
Mở Terminal tại thư mục presentation_Integration và chạy lệnh:

Bash
npm install
Bước 2: Khởi động Server BFF
Chạy lệnh sau để bật Backend (Server sẽ tự động nạp dữ liệu từ file cache lên RAM hoặc tự động cào dữ liệu nếu là lần chạy đầu tiên):

Bash
node bff-server.js
Console sẽ thông báo 🟢 BFF Server đang chạy tại http://localhost:3000 khi đã sẵn sàng.

Bước 3: Xem Dashboard
Mở file index.html trực tiếp trên trình duyệt Web (Chrome, Edge,...).

Hoặc sử dụng Extension Live Server trên VS Code để trải nghiệm tốt nhất.

Lưu ý: Bấm Ctrl + F5 nếu cần xóa cache giao diện trên trình duyệt.

Bước 4: Đồng bộ dữ liệu thủ công (Manual Sync)
Để ép Server chạy lại thuật toán gộp xếp hạng và cào dữ liệu mới nhất, ấn vào nút "Sync All Systems" trên Dashboard hoặc gọi lệnh:

Bash
curl http://localhost:3000/api/sync?force=true
