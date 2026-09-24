# AGV Queue Setup

ระบบนี้ทำให้คำสั่งจาก n8n Chat สร้างงานใน Google Sheet ก่อน แล้ว Warehouse Simulator เป็นผู้รับงานและสั่ง Animation AGV

## ลำดับการทำงาน

`n8n Chat → PENDING → Simulator รับงาน → RUNNING → AGV วิ่ง → อัปเดต Stock → COMPLETED`

Stock จะยังไม่เปลี่ยนตอน Chat สร้างงาน และจะเปลี่ยนเมื่อ AGV กลับถึงจุดจอดและปิดงานสำเร็จ

## 1. อัปเดต Google Apps Script

1. เปิด Google Sheet หลัก
2. ไปที่ **Extensions → Apps Script**
3. แทนที่โค้ดใน `Code.gs` ด้วยไฟล์ `google-apps-script/Code.gs` ชุดล่าสุด
4. กด **Save**
5. เลือกฟังก์ชัน `testMasterSheet` แล้วกด **Run** หนึ่งครั้ง
6. ไปที่ **Deploy → Manage deployments**
7. กดแก้ไข Deployment เดิม
8. เลือก **New version** แล้วกด **Deploy**

หากแก้ Deployment เดิม Web App URL จะยังเป็น URL เดิม

เมื่อรันครั้งแรก ระบบจะปรับแท็บ `Transactions` เดิมให้รองรับคอลัมน์ต่อไปนี้โดยไม่ลบประวัติ:

| Column | ความหมาย |
|---|---|
| Operation ID | รหัสงานที่ไม่ซ้ำกัน |
| Created At | เวลาสร้างงาน |
| Type | `IN` หรือ `OUT` |
| Location | ตำแหน่ง Rack |
| SKU | รหัสสินค้า |
| Quantity | จำนวนสินค้าเป็นค่าบวก |
| Balance | Stock หลังจบงาน |
| Status | `PENDING`, `RUNNING`, `COMPLETED`, `FAILED` |
| Started At | เวลา AGV รับงาน |
| Completed At | เวลาปิดงาน |
| Message | รายละเอียดสถานะ |
| Source | แหล่งคำสั่ง เช่น `N8N_CHAT` |
| Worker | Simulator ที่รับงาน |

## 2. Import n8n Workflow v3

Import ไฟล์:

`Fakduai-Warehouse-Chatbot-v3-AGV-Queue.json`

จากนั้นตั้งค่า:

1. OpenAI Credential ใน `OpenAI Chat Model`
2. Google Sheets Credential ใน `Inventory Lookup`
3. ตรวจ Spreadsheet และแท็บ `Inventory`
4. Save Workflow

## 3. เปิด Simulator

1. เชื่อม Google Sheet ของกลุ่ม
2. เปิด **Auto Sync**
3. สถานะ Auto Sync ควรเป็น `ON`

Simulator จะตรวจคิวประมาณทุก 2–3 วินาที เมื่อพบงานจะ Claim งานเพียงครั้งเดียวแล้วเริ่ม AGV

## 4. ทดสอบ

พิมพ์ใน n8n Chat:

`เบิก A001 จำนวน 10 ชิ้น`

AI ควรสรุปงานและถามยืนยัน ให้ตอบ:

`ยืนยัน`

ผลที่ควรเห็น:

1. แท็บ `Transactions` มีงานใหม่สถานะ `PENDING`
2. หน้า Simulator แสดงว่างานมาจาก AI
3. สถานะเปลี่ยนเป็น `RUNNING` และ AGV เริ่มวิ่ง
4. เมื่อ AGV กลับจุดจอด Stock จึงถูกอัปเดต
5. สถานะสุดท้ายเป็น `COMPLETED`

## หมายเหตุ

- อย่าแก้ Stock โดยตรงจาก n8n สำหรับคำสั่ง AGV
- หาก Auto Sync ปิดอยู่ งานจะค้างที่ `PENDING` จนกด Refresh หรือเปิด Auto Sync
- หาก SKU ไม่มีบนแผนที่ งานจะเปลี่ยนเป็น `FAILED`
