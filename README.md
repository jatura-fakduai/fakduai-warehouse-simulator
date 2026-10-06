# Fakduai Warehouse Simulator

คลังสินค้าจำลองแบบ Isometric สำหรับ Workshop **AI Logistics Chatbot** ของ Fakduai Lab
แสดงชั้นวาง สินค้า และรถ AGV ที่วิ่งรับเข้าและเบิกออกตามงานที่ AI สร้างจาก LINE

**เปิดใช้งาน:** https://fakduai-warehouse-simulator.pages.dev/
**Code Lab ของ Workshop:** https://fakduai-warehouse-simulator.pages.dev/codelab/

## ระบบทำงานยังไง

```text
LINE OA ──> n8n (AI Agent) ──> Google Sheet ──> Simulator ──> AGV วิ่ง ──> อัปเดต Stock
                  │                 ▲               │
                  └─ อ่าน Inventory ─┘               └─ อ่าน/ปิดงานผ่าน Apps Script
```

1. ผู้ใช้สั่งใน LINE เช่น `เบิก A001 จำนวน 10 ชิ้น` แล้วตอบ `ยืนยัน`
2. n8n เพิ่มงานสถานะ `PENDING` ลงแท็บ `Transactions` ของ Google Sheet
3. Simulator ที่เปิด **Auto Sync** ไว้ จะตรวจคิวทุก 2–3 วินาที แล้วรับงาน (`RUNNING`)
4. AGV วิ่งไปที่ชั้นวาง เมื่อกลับถึงจุดจอด Stock ในแท็บ `Inventory` จึงถูกอัปเดต และงานเป็น `COMPLETED`

Stock **ไม่เปลี่ยน** ตอนสร้างงาน จะเปลี่ยนเมื่อ AGV ทำงานเสร็จเท่านั้น

## ในไฟล์นี้มีอะไร

| ไฟล์ / โฟลเดอร์ | หน้าที่ |
|---|---|
| `public/` | หน้าเว็บ Simulator ทั้งหมด (HTML, CSS, JS, รูป) เป็น static site ไม่ต้อง build |
| `public/codelab/` | Code Lab ของ Workshop (หน้าเว็บสอนทีละขั้น พร้อมภาพหน้าจอและวิดีโอเตรียมความพร้อม) |
| `public/app.js` | Logic ของ Simulator และค่าเชื่อมต่อ Apps Script (`CENTRAL_SHEET_CONNECTOR`) |
| `google-apps-script/Code.gs` | ตัวกลางระหว่าง Simulator กับ Google Sheet อ่าน Inventory รับงาน ปิดงาน และอัปเดต Stock |
| `n8n/Fakduai-Warehouse-Chatbot-v5-LINE.json` | Workflow ล่าสุดที่ใช้ใน Workshop รับคำสั่งจาก LINE OA (แนะนำ) |
| `n8n/Fakduai-Warehouse-Chatbot-v4-Direct-Sheets.json` | รุ่นทดสอบผ่าน n8n Chat ไม่ต้องมี LINE |
| `n8n/Fakduai-Warehouse-Chatbot-v3-AGV-Queue.json` | รุ่นเก่า สร้างงานผ่าน Apps Script |
| `AGV_QUEUE_SETUP.md` | รายละเอียดคิวงาน AGV และคอลัมน์ของแท็บ `Transactions` |
| `.github/workflows/` | Deploy `public/` ขึ้น Cloudflare Pages อัตโนมัติ |

## ใช้ใน Workshop (ไม่ต้องติดตั้งอะไร)

1. เปิด https://fakduai-warehouse-simulator.pages.dev/
2. กด **Workshop Data** มุมขวาบน
3. วางลิงก์ Google Sheet ของกลุ่มที่ทีมงานแจก แล้วกด **เชื่อมต่อ Google Sheet**
4. ต้องขึ้นว่า `เชื่อมต่อสำเร็จ · โหลด 9 ตำแหน่งจาก Inventory` และ **Auto Sync** เป็น `ON`

> ตัวที่ Deploy ไว้เชื่อมได้เฉพาะ Sheet ที่เป็นของบัญชี Google ที่ Deploy Apps Script เท่านั้น
> ถ้าคุณทำสำเนา Sheet เองแล้วเชื่อมไม่ได้ ให้ตั้งระบบของตัวเองตามหัวข้อถัดไป

## ตั้งระบบของตัวเอง

ใช้เวลาประมาณ 20 นาที ต้องมีบัญชี Google และ GitHub

### 1. เตรียม Google Sheet

1. สร้าง Google Sheet ใหม่ มี 2 แท็บชื่อ `Inventory` และ `Transactions`
   (หรือทำสำเนาจาก Sheet ตัวอย่างของ Workshop)
2. แท็บ `Inventory` แถวแรกเป็นหัวคอลัมน์ตามนี้ แล้วใส่ข้อมูล 1 แถวต่อ 1 ชั้นวาง

   | Location | SKU | Name | Category | Stock | Capacity | Color |
   |---|---|---|---|---|---|---|
   | B2-03 | A001 | UHT Milk | Dairy | 80 | 100 | #69a7ff |

   Simulator มีชั้นวาง 9 ตำแหน่ง: `A1-01` `A1-02` `A1-03` `B2-01` `B2-03` `B3-03` `C3-01` `C3-02` `C3-03`
3. แท็บ `Transactions` ปล่อยว่างได้ Apps Script จะสร้างหัวคอลัมน์ให้ตอนรันครั้งแรก

### 2. Deploy Apps Script

1. ใน Google Sheet ไปที่ **ส่วนขยาย (Extensions) → Apps Script**
2. ลบโค้ดเดิม แล้ววางโค้ดจาก `google-apps-script/Code.gs`
3. **เปลี่ยน `API_KEY`** บรรทัดบนสุดเป็นข้อความสุ่มของคุณเอง (อย่างน้อย 32 ตัวอักษร)
4. กด **Save** เลือกฟังก์ชัน `testMasterSheet` แล้วกด **Run** อนุญาตสิทธิ์ตามที่ Google ถาม
5. กด **Deploy → New deployment** เลือกประเภท **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone**
6. กด **Deploy** แล้วคัดลอก **Web app URL** (ลงท้ายด้วย `/exec`)

### 3. ชี้ Simulator ไปที่ Apps Script ของคุณ

1. Fork repo นี้
2. แก้ `public/app.js` ส่วนบนของไฟล์

   ```js
   const CENTRAL_SHEET_CONNECTOR = Object.freeze({
     webAppUrl: "https://script.google.com/macros/s/<ของคุณ>/exec",
     key: "<API_KEY เดียวกับใน Code.gs>"
   });
   ```

3. ทดสอบในเครื่อง:

   ```bash
   npx serve public
   # หรือ
   python3 -m http.server 8080 --directory public
   ```

   เปิด `http://localhost:8080` แล้วเชื่อม Sheet ของคุณผ่าน **Workshop Data**

### 4. Import n8n Workflow

1. ใน n8n สร้าง Workflow ใหม่ แล้ว Import `n8n/Fakduai-Warehouse-Chatbot-v5-LINE.json`
   (ถ้ายังไม่มี LINE OA ใช้ `v4-Direct-Sheets.json` ทดสอบผ่านหน้า Chat ของ n8n ได้)
2. ตั้งค่า Credential:

   | Node | ตั้งค่า |
   |---|---|
   | OpenAI Chat Model | OpenAI Credential และเปิด **Use Responses API** (ต้องใช้กับโมเดลอย่าง `gpt-6-luna` ที่เรียก Tool ผ่าน Chat Completions ไม่ได้) |
   | Inventory Lookup, Transaction Lookup, Create AGV Job | Google Sheets Credential และเลือก Document เป็น Sheet ของคุณ |
   | Reply to LINE | Header Auth: `Authorization` = `Bearer <Channel access token>` |
   | LINE Webhook | ตั้ง path แล้วนำ Production URL ไปใส่ใน LINE Developers |

3. กด **Publish** แล้วทดสอบใน LINE: `เบิก A001 จำนวน 10 ชิ้น` → `ยืนยัน`

ขั้นตอนเชื่อม LINE OA กับ n8n แบบละเอียด ดูได้ใน [Code Lab ของ Workshop](https://fakduai-warehouse-simulator.pages.dev/codelab/)

### 5. Deploy ขึ้น Cloudflare Pages (ไม่บังคับ)

Push ขึ้น branch `main` จะ Deploy โฟลเดอร์ `public/` อัตโนมัติ ต้องตั้ง GitHub Actions secrets:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN` สิทธิ์ **Account → Cloudflare Pages → Edit**

ถ้าใช้ชื่อโปรเจกต์อื่น แก้ `--project-name` ใน `.github/workflows/deploy-cloudflare-pages.yml`
หรือจะเอาโฟลเดอร์ `public/` ไปวางบน GitHub Pages, Netlify หรือ Vercel ก็ได้

## แก้ปัญหา

| อาการ | สาเหตุ | วิธีแก้ |
|---|---|---|
| `ซิงก์ไม่สำเร็จ` | ลิงก์ Sheet ผิด หรือ Sheet ไม่ได้เป็นของบัญชีที่ Deploy Apps Script | ตรวจลิงก์ หรือ Deploy Apps Script จากบัญชีเจ้าของ Sheet |
| `Connection Key ไม่ถูกต้อง` | `key` ใน `app.js` ไม่ตรงกับ `API_KEY` ใน `Code.gs` | ตั้งให้ตรงกัน แล้ว Deploy Apps Script เวอร์ชันใหม่ |
| งานค้างที่ `PENDING` | Auto Sync ปิดอยู่ หรือไม่มีหน้า Simulator เปิดไว้ | เปิด Simulator และ Auto Sync |
| งานเป็น `FAILED` | SKU หรือ Location ไม่มีบนแผนที่ | ใช้ Location ที่ Simulator มีเท่านั้น |
| `Function tools with reasoning_effort are not supported` | OpenAI Chat Model ใช้ Chat Completions | ลบ node แล้วเพิ่มใหม่ เปิด **Use Responses API** |
| แก้ `Code.gs` แล้วไม่มีผล | ยังไม่ได้ Deploy เวอร์ชันใหม่ | **Deploy → Manage deployments → แก้ไข → New version** (URL เดิมยังใช้ได้) |

## ข้อควรระวัง

- `API_KEY` ใน `Code.gs` และ `key` ใน `app.js` อยู่ในหน้าเว็บที่ทุกคนเปิดดูได้ ใช้กันการเรียกแบบสุ่มเท่านั้น ไม่ใช่การป้องกันจริง ใช้กับข้อมูลทดลองเท่านั้น
- อย่าให้ n8n เขียนแท็บ `Inventory` โดยตรง Simulator เป็นผู้คำนวณ Stock ตอนปิดงาน
