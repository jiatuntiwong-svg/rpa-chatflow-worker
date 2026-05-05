# RPA Chatflow

MVP สำหรับทำระบบแชทบอทแนว ManyChat ใช้งานเอง โดยเริ่มจาก Facebook Messenger webhook, flow engine, SQLite state management, broadcast และหน้า admin สำหรับแก้ flow

## สิ่งที่มีในเวอร์ชันนี้

- `GET /webhook` สำหรับ Meta webhook verification
- `POST /webhook` สำหรับรับข้อความจาก Messenger
- เก็บ subscriber, state และ event log ด้วย SQLite
- Flow logic จากไฟล์ `data/flows.json`
- ส่งข้อความกลับผ่าน Facebook Graph API เมื่อใส่ `PAGE_ACCESS_TOKEN`
- Dry run mode เมื่อยังไม่ใส่ token
- หน้า admin ที่ `http://127.0.0.1:8000`

## วิธีรัน

```powershell
python app.py
```

สร้างไฟล์ `.env` จาก `.env.example` แล้วใส่ค่าจริง:

```text
HOST=127.0.0.1
PORT=8000
VERIFY_TOKEN=ตั้งรหัสยืนยันของคุณ
PAGE_ACCESS_TOKEN=Page access token จาก Meta
GRAPH_API_VERSION=v19.0
```

หรือจะตั้งค่า env ก่อนรันก็ได้:

```powershell
$env:VERIFY_TOKEN="ตั้งรหัสยืนยันของคุณ"
$env:PAGE_ACCESS_TOKEN="Page access token จาก Meta"
$env:GRAPH_API_VERSION="v19.0"
python app.py
```

ถ้าทดสอบกับ Meta บนเครื่องตัวเอง ให้เปิด HTTPS tunnel เช่น ngrok:

```powershell
ngrok http 8000
```

แล้วนำ URL เช่น `https://xxxx.ngrok-free.app/webhook` ไปใส่ใน Messenger Webhooks ของ Meta

## โครงสร้าง Flow

แก้ได้ทั้งจากหน้า admin หรือไฟล์ `data/flows.json`

```json
{
  "name": "Demo Messenger Flow",
  "start": "start",
  "fallback": "fallback",
  "nodes": {
    "start": {
      "message": "สวัสดีครับ",
      "quick_replies": [
        { "title": "ดูสินค้า", "payload": "PRODUCTS", "next": "products" }
      ],
      "next": "start"
    },
    "products": {
      "message": "รายละเอียดสินค้า...",
      "keywords": ["สินค้า", "PRODUCTS"],
      "next": "products"
    }
  }
}
```

## API ฝั่ง Admin

- `GET /api/flows`
- `PUT /api/flows`
- `GET /api/subscribers`
- `GET /api/events`
- `POST /api/broadcast`

## หมายเหตุสำคัญก่อนใช้งานจริง

- Broadcast บน Messenger ต้องทำตามนโยบาย Meta เรื่องช่วงเวลา 24 ชั่วโมง, message tags และ opt-in
- ควรเพิ่ม authentication ให้หน้า admin ก่อน deploy จริง
- ควรย้าย secret ไปใช้ environment variables หรือ secret manager
- สำหรับ production แนะนำวางหลัง reverse proxy ที่เป็น HTTPS
