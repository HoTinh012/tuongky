# Đưa Tượng Kỳ lên mạng (Render)

Hướng dẫn deploy web lên [Render](https://render.com) bằng file cấu hình `render.yaml` có sẵn trong repo.
Dữ liệu (tài khoản, xu, ván, cài đặt) nằm trên **Supabase**, nên server trên Render chỉ cần chạy code.

> Thời gian làm: khoảng 15 phút. Chi phí: gói **Starter ~7 USD/tháng** (khuyên dùng).
> Gói Free cũng chạy được nhưng tự "ngủ" sau 15 phút không có ai vào → ván đang chơi bị mất, lần vào đầu chờ 30–60 giây.

---

## 0. Chuẩn bị (đã xong trên máy)

- [x] Supabase đã tạo bảng (`supabase/schema.sql`) và web đã chạy được với Supabase trên máy.
- [x] File `.env` trên máy có `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `ADMIN_PASSWORD`.
  **File `.env` không được đưa lên GitHub** — bạn sẽ chép 3 giá trị này vào Render ở bước 3.
- [ ] Code mới nhất (kể cả `render.yaml`) đã đẩy lên GitHub:
  ```
  git add -A
  git commit -m "Cấu hình deploy Render"
  git push
  ```

## 1. Tạo tài khoản Render & nối GitHub

1. Vào https://render.com → **Get Started** → đăng nhập bằng **GitHub**.
2. Cho phép Render đọc repo **HoTinh012/tuongky** (chọn *Only select repositories* → chọn `tuongky`).

## 2. Tạo dịch vụ từ Blueprint

1. Trên Render Dashboard bấm **New +** → **Blueprint**.
2. Chọn repo **tuongky** → Render tự đọc `render.yaml` và hiện dịch vụ **tuongky** (Web Service, Node, Singapore, Starter).
3. Nếu muốn dùng gói Free: đổi `plan: starter` thành `plan: free` trong `render.yaml`, đẩy lên GitHub rồi làm lại bước này
   (hoặc đổi gói sau trong **Settings → Instance Type**).

## 3. Điền biến môi trường (bí mật)

Render sẽ hỏi 3 giá trị được đánh dấu `sync: false`. Mở file `.env` trên máy và chép **đúng** từng dòng:

| Biến | Lấy từ | Ghi chú |
|---|---|---|
| `SUPABASE_URL` | `.env` (dạng `https://xxxx.supabase.co`) | |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env` | Khoá **service_role** — bí mật, chỉ dán vào Render |
| `ADMIN_PASSWORD` | `.env` | Nên là mật khẩu mạnh (≥ 12 ký tự) |

`NODE_VERSION` và `SUPABASE_BUCKET` đã có sẵn trong `render.yaml`, không cần nhập.
Bấm **Apply** → Render bắt đầu build.

## 4. Chờ build & kiểm tra log

Trong trang dịch vụ **tuongky** → tab **Logs**, chờ đến khi thấy:

```
Tượng Kỳ đang chạy tại http://localhost:10000
Dữ liệu: Supabase (xxxx.supabase.co)
Trang quản trị yêu cầu mật khẩu (ADMIN_PASSWORD).
```

- Thấy `Dữ liệu: file JSON` → chưa nhập đúng `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (bước 3).
- Thấy `Không tải được Pikafish` → web vẫn chạy, máy phân tích dùng engine trong trình duyệt (yếu hơn). Thử **Manual Deploy → Clear build cache & deploy**.
- Lần build đầu mất 3–6 phút (cài thư viện + tải engine).

Địa chỉ web nằm ở đầu trang dịch vụ, dạng **https://tuongky.onrender.com** (hoặc có thêm vài ký tự).

## 5. ⚠️ Tắt server trên máy

Server trên máy đang nối **cùng Supabase**. Hai server chạy cùng lúc sẽ ghi đè dữ liệu của nhau (mất xu, mất ván).
Khi bản trên Render đã chạy:

- Tắt server trên máy (Ctrl+C ở cửa sổ đang chạy `npm start`), **hoặc**
- Muốn thử trên máy song song: mở `.env`, thêm dấu `#` đầu 2 dòng `SUPABASE_URL` và `SUPABASE_SERVICE_ROLE_KEY`
  → máy quay về dùng file JSON riêng trong `data/`, không đụng tới Supabase.

## 6. Thử trên bản đã deploy

Dùng **2 thiết bị / 2 trình duyệt khác nhau** (hoặc 1 tab ẩn danh):

- [ ] Đăng ký, đăng nhập, đổi ảnh đại diện (ảnh phải hiện lại sau khi tải lại trang).
- [ ] Ghép trận **Xếp hạng** giữa 2 tài khoản → chơi vài nước → kết thúc → Elo & xu thay đổi.
- [ ] **Tranh xu**: vào bàn, cả hai bấm *Xác nhận bắt đầu* → thắng/thua → xu chuyển đúng.
- [ ] **Đấu lại** sau ván ghép trận.
- [ ] Trang **AI → Phân tích**: engine chạy, có điểm số.
- [ ] Vào `/admin` → đăng nhập bằng `ADMIN_PASSWORD` → chỉnh thử một cài đặt.

## 7. Cập nhật sau này

`autoDeploy: true` → mỗi lần `git push` lên nhánh `main`, Render tự build & deploy bản mới.
Lưu ý: mỗi lần deploy, server khởi động lại → **các ván đang chơi dở bị mất** (tài khoản, xu, lịch sử vẫn còn trên Supabase).
Nên deploy lúc ít người chơi.

## 8. (Tuỳ chọn) Tên miền riêng

Trang dịch vụ → **Settings → Custom Domains → Add** (vd `tuongky.vn`) → làm theo hướng dẫn thêm bản ghi DNS
ở nơi mua tên miền. Render tự cấp HTTPS.

---

### Giới hạn cần biết
- **Chỉ 1 server** (`numInstances: 1`) — không tăng số instance, vì phòng chơi nằm trong bộ nhớ server.
- Engine Pikafish khá tốn CPU; nhiều người phân tích cùng lúc thì nâng gói (Standard) hoặc giảm giới hạn trong
  **Admin → Cài đặt hệ thống → Engine phân tích**.
- Pikafish & Fairy-Stockfish dùng giấy phép GPL — giữ dòng ghi nguồn ở chân trang.
