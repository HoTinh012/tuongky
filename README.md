# Cờ Tướng Online

Web chơi cờ tướng 2 người theo phòng, thời gian thực (Node.js + Socket.io).

## Tính năng
- Tạo phòng → gửi link mời → chơi ngay, không cần đăng ký
- **Ghép trận nhanh**: ghép người đang online, ưu tiên Elo gần nhau (±100, nới ±50 mỗi 5 giây chờ, sau 60 giây ghép bất kỳ);
  ưu tiên cùng thể thức thời gian; màu quân ngẫu nhiên
- Thẻ người chơi có ảnh đại diện, **viền quanh ảnh chạy theo thời gian nước đi**; đối thủ ở trên bên trái, mình ở dưới bên phải
- **Thời gian** khi tạo phòng: thời gian mỗi bên (5–60 phút) và mỗi nước (30 giây–5 phút), hoặc không giới hạn.
  Đồng hồ do server tính; hết tổng giờ hoặc hết giờ một nước thì thua
- **Tài khoản (không bắt buộc)**: đăng ký / đăng nhập; tài khoản được lưu thành tích (online & với máy) và
  lịch sử ván. Trang **Tài khoản** xem thống kê, lịch sử, mở lại ván cũ để phân tích, đổi tên hiển thị & mật khẩu.
  Có **ảnh đại diện** (tự cắt vuông 256×256). Khách vẫn chơi bình thường nhưng không được lưu.
- **Hồ sơ người chơi** (tông gỗ): điểm **Elo** (chỉ tính ván online giữa 2 tài khoản),
  khu vực, **uy tín** (+1 mỗi ván trọn, −10 khi bỏ ván), **xu** (+20/ngày đăng nhập, +10/ván online, +10 khi thắng),
  chuỗi thắng, thẻ kỳ hữu theo số ván; menu Lịch sử / Thống kê / Cài đặt / Trợ giúp & góp ý (gửi về trang quản trị) / Giới thiệu bạn bè Mật khẩu băm bằng scrypt; ván với máy được server kiểm tra lại
- **Bài tập** (giải thế cờ): danh sách có lọc độ khó, giải từng nước (máy tự đáp trả), gợi ý, xem lời giải;
  tài khoản giải lần đầu +5 xu. Quản trị viên soạn bài trong admin: bày thế cờ, ghi lời giải bằng cách đi quân,
  server kiểm tra thế cờ & lời giải hợp lệ. Dữ liệu ở `data/puzzles.json` (bài mẫu ban đầu từ `puzzles-seed.json`)
- **Chơi với máy** 3 mức Dễ / Vừa / Khó, có nút Đi lại. Máy tính nước ngay trên trình duyệt
  (Web Worker, `public/engine.js`: alpha-beta + quiescence + bảng chuyển vị), không tốn tài nguyên server
- Chọn màu quân Đỏ / Đen / Ngẫu nhiên; người thứ 3 trở đi vào xem
- Server kiểm tra đầy đủ luật: cản chân mã, cản mắt tượng, pháo ngòi, tốt qua sông, cung tướng, lộ mặt tướng, không được tự để tướng bị chiếu
- Tự phát hiện chiếu, chiếu bí, hết nước đi (bên hết nước thua)
- Xin hoà, đầu hàng, chơi lại (tự đổi màu), chat trong phòng
- Hết ván hiện bảng kết quả lớn giữa bàn cờ với các nút Chơi lại / Phân tích / Rời bàn
- Bấm "Phân tích" để xem biên bản (ký hiệu P2-5, M8.7…) và tua lại từng nước bằng ⏮ ◀ ▶ ⏭ hoặc phím ← →
- Phân tích đánh giá từng nước: ★ tốt nhất, ✓ tốt, ?! thiếu chính xác, ? sai lầm, ?? sai lầm nghiêm trọng;
  độ chính xác (%) mỗi bên, biểu đồ thế trận, gợi ý nước tốt hơn và mũi tên chỉ nước tốt nhất trên bàn cờ
- Lưu tối đa 20 ván đã chơi trong phòng để xem lại, tải biên bản về file .txt
- Tải lại trang hoặc rớt mạng vẫn giữ được ghế (tối đa 90 giây, đổi bằng biến `ABANDON_SECONDS`)
- Mỗi người chỉ ngồi chơi ở 1 phòng tại một thời điểm
- Người chơi rời bàn → ghế trống cho người khác vào (ván đã có nước đi thì người rời bị xử thua);
  phòng tự huỷ khi không còn ai trong phòng
- Giao diện tiếng Việt, dùng được trên điện thoại

## Chạy trên máy
```bash
npm install
npm start
```
Mở http://localhost:3000. Muốn thử một mình thì mở 2 tab.

Chơi với người cùng mạng Wi‑Fi: gửi họ địa chỉ `http://<IP-máy-bạn>:3000`
(xem IP bằng `ipconfig getifaddr en0` trên macOS).

## Trang quản trị
Mở http://localhost:3000/admin

- **Mật khẩu:** mặc định không cần. Khi đưa lên mạng, đặt biến môi trường `ADMIN_PASSWORD` để
  trang quản trị yêu cầu đăng nhập (nếu không, ai biết đường dẫn /admin cũng vào được).
- **Tài khoản:** chỉ tài khoản đã đăng ký được lưu (trong `data/db.json`): thông tin, thành tích, lịch sử ván.
  Bấm **Xem** để xem chi tiết & lịch sử ván của từng tài khoản.
- **Giao diện bàn cờ** (tab trong trang quản trị): chọn bàn cờ có sẵn hoặc tải ảnh bàn cờ mới lên (tự nhận diện
  lưới 9×10, chỉnh tay được), chọn kiểu quân (Gỗ khắc / Cổ điển / Ngọc bích / Hiện đại), font chữ và màu chữ.
  Bấm Lưu là áp dụng ngay cho mọi người đang chơi. Ảnh tải lên lưu trong `data/uploads/`, cấu hình trong `data/theme.json`.
- Quản trị viên có thể: xem ai đang online và ở phòng nào, tìm/lọc/sắp xếp người chơi, đổi tên
  (tên sẽ bị cố định), mời ra khỏi phòng, khoá/mở khoá, xoá dữ liệu; xem danh sách phòng, vào xem
  (không chiếm ghế), đóng phòng.

## Kiểm thử luật cờ
```bash
npm test
```

## Đưa lên mạng (chơi với bạn ở xa)
Cần dịch vụ hỗ trợ Node.js + WebSocket, ví dụ Render, Railway, Fly.io:
1. Đưa thư mục này lên GitHub.
2. Tạo Web Service mới từ repo, lệnh build `npm install`, lệnh chạy `npm start`.
3. Server tự dùng biến môi trường `PORT` do dịch vụ cấp.

Lưu ý: phòng chơi lưu trong bộ nhớ, khởi động lại server sẽ mất các ván đang chơi. Dữ liệu người chơi
nằm trong thư mục `data/` — khi đưa lên mạng nhớ đặt `ADMIN_PASSWORD` và dùng ổ đĩa lưu trữ lâu dài
(hoặc biến `DATA_DIR`) để không mất dữ liệu.

## Cấu trúc
- `server.js` — quản lý phòng, kiểm tra nước đi, đồng bộ trạng thái
- `users.js` — lưu người chơi & thống kê; `admin.js` — API trang quản trị; `admin/` — giao diện quản trị
- `public/xiangqi.js` — luật cờ (dùng chung cho server và trình duyệt)
- `public/app.js`, `index.html`, `style.css` — giao diện
