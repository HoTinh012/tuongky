# Tượng Kỳ — Cờ tướng Việt

Nền tảng cờ tướng online thời gian thực (Node.js + Socket.io): xếp hạng Elo, Tranh xu, giải đấu, bạn bè, đấu máy, cờ thế.

## Giao diện (theo Figma + tài liệu "Tượng Kỳ – Product UX")
Tông kem / đỏ son `#C61D1D` / ngà `#F2D7A6` / đen nâu `#1B1612`, logo quân Tượng (象). Menu trái gồm:
- **Trang chủ**: lời chào, banner, lối vào nhanh, nhiệm vụ hằng ngày, giải đang diễn ra, cửa hàng, trận đấu hot, phong độ cá nhân
- **Chơi nhanh**: **Xếp hạng** (nhịp cố định 15+5, hiện Elo & bậc rank hiện tại, phí 10 xu, bước xác nhận 12 giây khi tìm thấy đối thủ); **Tranh xu**
  (bàn chờ: chọn nhịp & mức đặt → vào bàn đang chờ cùng thiết lập, chưa có thì tự tạo bàn và chờ đối thủ;
  trang Tranh xu có danh sách "Bàn đang chờ"); **Chơi với bạn** (phòng riêng mã 6 ký tự, tuỳ chọn cho đi lại / cho xem, nút Sẵn sàng);
  **Trận đấu hot** (`/api/live`) — bấm để vào xem trực tiếp
- **Bàn cờ online**: người chơi trên/dưới bàn cờ kèm đồng hồ; cột phải: lịch sử nước đi, trò chuyện, xin hoà / đầu hàng
- **Kết thúc ván**: bàn cờ thu nhỏ sang phải; kết quả, tỉ số, Elo/xu thay đổi, thống kê, biểu đồ 6 chỉ số
  (khai cuộc, trung cuộc, tàn cuộc, chính xác, chiến thuật, quản lý thời gian — do máy chấm), Chơi tiếp / Phân tích / Chia sẻ
- **Đấu máy**: 9 cấp độ AI, chọn màu quân, gợi ý & đi lại, thẻ **Máy phân tích** (3 nước tốt nhất + điểm) trong ván;
  tab **Cờ thế**, **Lịch sử luyện tập** và **Phân tích** (`#/ai/analysis`, `public/analysis.js`): bàn cờ tự do đi quân cho
  cả hai bên, engine phân tích liên tục (Pikafish trên server qua `POST /api/engine/stream`, hoặc Fairy-Stockfish trên
  trình duyệt), 1–10 phương án hoặc **tất cả nước** — mỗi nước có nhãn (★ Tốt nhất / ✓ Tốt / ?! Không chính xác /
  ? Sai lầm / ?? Sai lầm nặng), thanh mạnh/yếu (tỉ lệ thắng), điểm và diễn biến mẫu; chọn một quân thì điểm từng nước
  hiện ngay trên bàn cờ; độ sâu / số nút / tốc độ, thanh thế trận, mũi tên nước tốt nhất, bấm phương án để đi,
  biên bản tua lại & rẽ nhánh (← →), lật bàn, bày thế cờ, nhập / xuất FEN
- **Xếp hạng** (`/api/leaderboard`): Elo, Bạn bè, Danh vọng mùa, chuỗi thắng, Tranh xu, cờ thế; vị trí của bạn
- **Giải đấu**: danh sách theo trạng thái (mở đăng ký / check-in / đang đấu / kết thúc), trang giải có nhánh đấu
  hoặc bảng điểm, lịch các vòng, đăng ký / rút lui / check-in / **Vào bàn**
- **Bạn bè**: tìm kỳ thủ, lời mời kết bạn, ai đang online / đang chơi, mời đấu, xem trận, hoạt động của kỳ hữu,
  gợi ý từ đối thủ cũ, chặn / báo cáo; chuông **thông báo** (lời mời, giải đấu…)
- **Túi đồ & Cửa hàng**: bàn cờ / quân cờ / đồng hồ — mua bằng xu, lưu trên tài khoản, chỉ đổi giao diện
- **Hồ sơ kỳ thủ**: Elo, biểu đồ Elo, thống kê theo chế độ, nhịp yêu thích, huy hiệu giải, điểm Danh vọng mùa,
  bộ trang bị, lịch sử đấu (loại ván, nhịp, Elo & xu thay đổi, link xem lại)

## Quy tắc xu & Elo (các câu hỏi để ngỏ ở mục 25 của tài liệu — giá trị đang dùng)
Chỉnh trong trang quản trị → **Chế độ chơi & xu** (giá trị mặc định ở `public/catalog.js` → `ECONOMY`).
- Xu chỉ dùng trong game, không quy đổi tiền thật. Vật phẩm chỉ đổi giao diện.
- Tài khoản mới được tặng **1000 xu** (`START_COINS` trong `users.js`); tài khoản đã có giữ nguyên số xu.
- **Xếp hạng**: nhịp cố định 15 phút + 5 giây/nước (`RANKED_TC` trong `public/catalog.js`, server ép nhịp này). Phí 10 xu/ván, trừ khi ván bắt đầu, không hoàn. Thưởng +10 xu khi chơi trọn ván, thắng thêm +10. Tính Elo.
- **Tranh xu**: mức đặt 50 / 100 / 200 / 500, người thắng nhận mức đặt của người thua, hoà hoàn 100%,
  hệ thống không lấy phí, **không tính Elo**. Nhịp Cờ chớp / Cờ nhanh. Không ghép trận: người chơi vào **bàn chờ**
  (server `coin-seat`: tìm bàn cùng nhịp & mức đặt, không có thì tạo bàn mới). Chỉ tài khoản đủ xu mới ngồi được bàn tranh xu.
- **Phòng riêng**: không xu, không Elo.
- **Giải đấu**: tính Elo (giữa 2 tài khoản), lệ phí tuỳ giải (hoàn nếu rút lui / giải huỷ), top 3 nhận xu + huy hiệu.
- **Đấu máy**: +2 xu/ván, thắng thêm +3. Cờ thế: +5 xu lần đầu giải. Đăng nhập mỗi ngày +20 xu.
- **Danh vọng mùa** (mỗi quý một mùa): thắng 3, hoà 1 ở ván Xếp hạng / Tranh xu / Giải đấu; huy hiệu giải cộng thêm.
- **Nhiệm vụ ngày**: 3 nhiệm vụ mỗi ngày (chơi ván, thắng xếp hạng, giải cờ thế…), bấm nhận thưởng xu.

## Tính năng
- Tạo phòng → gửi link mời → chơi ngay, không cần đăng ký
- **Ghép trận nhanh**: ghép người đang online, ưu tiên Elo gần nhau (±100, nới ±50 mỗi 5 giây chờ, sau 60 giây ghép bất kỳ);
  ưu tiên cùng thể thức thời gian; màu quân ngẫu nhiên
- Thẻ người chơi có ảnh đại diện, **viền quanh ảnh chạy theo thời gian nước đi**; đối thủ ở trên bên trái, mình ở dưới bên phải
- **Thời gian** khi tạo phòng: nhịp x+y (thời gian mỗi bên + giây cộng thêm sau mỗi nước, vd 15+10),
  giới hạn mỗi nước (30 giây–5 phút), hoặc không giới hạn. Đồng hồ do server tính; hết tổng giờ hoặc hết giờ một nước thì thua
- **Tài khoản (không bắt buộc)**: đăng ký / đăng nhập; tài khoản được lưu thành tích (online & với máy) và
  lịch sử ván. Trang **Hồ sơ kỳ thủ** xem thống kê, lịch sử, mở lại ván cũ để phân tích, đổi tên hiển thị & mật khẩu.
  Có **ảnh đại diện** (tự cắt vuông 256×256). Khách vẫn chơi bình thường nhưng không được lưu.
- **Hồ sơ kỳ thủ**: điểm **Elo** (chỉ tính ván Xếp hạng & Giải đấu giữa 2 tài khoản), khu vực, **uy tín** (+1 mỗi ván trọn, −10 khi bỏ ván),
  **xu** (xem Quy tắc xu & Elo ở trên), chuỗi thắng; chỉnh sửa hồ sơ, trợ giúp & góp ý (gửi về trang quản trị),
  mời bạn bè. Mật khẩu băm bằng scrypt; ván với máy được server kiểm tra lại
- **Cờ thế** (giải thế cờ, trong trang Đấu máy): danh sách có lọc độ khó, giải từng nước (máy tự đáp trả), gợi ý, xem lời giải;
  tài khoản giải lần đầu +5 xu. Quản trị viên soạn bài trong admin: bày thế cờ, ghi lời giải bằng cách đi quân,
  server kiểm tra thế cờ & lời giải hợp lệ. Dữ liệu ở `data/puzzles.json` (bài mẫu ban đầu từ `puzzles-seed.json`)
- **Chơi với máy** 9 cấp độ (Tập sự → Kỳ vương → Vô đối), có Gợi ý và Đi lại (`public/engine-pro.js`):
  - Cấp 1–8: **Fairy-Stockfish** (WebAssembly) chạy ngay trên trình duyệt, giới hạn Elo theo cấp (800 → 2200)
  - Cấp 9 "Vô đối", Gợi ý và Phân tích ván: **Pikafish** (engine cờ tướng mạnh nhất, NNUE) chạy trên server (`engine-server.js`)
  - Dự phòng: trình duyệt không chạy được WebAssembly đa luồng (vd Safari) → dùng Pikafish trên server;
    server chưa cài Pikafish → dùng engine cũ `public/engine.js` (alpha-beta + quiescence + bảng chuyển vị)
- Chọn màu quân Đỏ / Đen / Ngẫu nhiên; người thứ 3 trở đi vào xem
- Server kiểm tra đầy đủ luật: cản chân mã, cản mắt tượng, pháo ngòi, tốt qua sông, cung tướng, lộ mặt tướng, không được tự để tướng bị chiếu
- Tự phát hiện chiếu, chiếu bí, hết nước đi (bên hết nước thua)
- Xin hoà, đầu hàng, chơi lại (tự đổi màu), chat trong phòng
- Hết ván chuyển sang màn kết quả (xem phần Giao diện) với các nút Chơi tiếp / Tái đấu / Phân tích / Chia sẻ / Rời bàn
- Bấm "Phân tích" để xem biên bản (ký hiệu P2-5, M8.7…) và tua lại từng nước bằng ⏮ ◀ ▶ ⏭ hoặc phím ← →
- Phân tích đánh giá từng nước theo tài liệu: !! Nước hay (thí quân đúng), ★ Chính xác, ✓ Tốt, ?! Không chính xác,
  ? Sai lầm, ✗ Bỏ lỡ chiến thuật; độ chính xác (%) mỗi bên, biểu đồ thế trận, gợi ý nước tốt hơn, mũi tên nước tốt nhất
  và **tổng kết 3 điểm làm tốt / 3 điểm cần cải thiện**
- **Chia sẻ**: thẻ ảnh kết quả (tải về hoặc chia sẻ thẳng trên điện thoại) và **link xem lại** `/#/replay/<mã ván>`
  — ai có link cũng xem được biên bản và phân tích
- **Trạng thái kết nối**: đối thủ mất kết nối hiện đếm ngược thời gian chờ; chủ phòng riêng rời đi thì phòng đóng
- **Cờ thế**: lọc theo độ khó & chủ đề (chiếu bí, bắt quân, phòng thủ, tàn cuộc), "Tiếp tục bài gần nhất",
  tổng kết sau khi giải (thời gian, số lần thử, gợi ý, điểm); lịch sử giải nằm trong Lịch sử luyện tập
- **Giải đấu**: Loại trực tiếp (xếp hạt giống, có miễn đấu; hoà → hạt giống cao đi tiếp), Vòng tròn, Hệ Thụy Sĩ
  (ghép cùng điểm, không gặp lại, Buchholz). Tự mở check-in, tự bắt đầu, tạo bàn giữ đúng ghế, thông báo vào bàn,
  quá giờ chờ thì xử thua, trao thưởng & huy hiệu
- Lưu tối đa 20 ván đã chơi trong phòng để xem lại, tải biên bản về file .txt
- Tải lại trang hoặc rớt mạng vẫn giữ được ghế (tối đa 90 giây, đổi bằng biến `ABANDON_SECONDS`)
- Mỗi người chỉ ngồi chơi ở 1 phòng tại một thời điểm
- Người chơi rời bàn → ghế trống cho người khác vào (ván đã có nước đi thì người rời bị xử thua);
  phòng tự huỷ khi không còn ai trong phòng
- Giao diện tiếng Việt, dùng được trên điện thoại

## Chạy trên máy
```bash
npm install
npm run setup:engine
npm start
```
Mở http://localhost:3000. Muốn thử một mình thì mở 2 tab.

`npm run setup:engine` tải Pikafish (~51 MB, bản phát hành chính thức trên GitHub) về `engines/pikafish/`
(không đưa lên git). Bỏ qua bước này thì web vẫn chạy, chỉ là cấp 9 / gợi ý / phân tích dùng engine yếu hơn.
Biến môi trường tuỳ chọn: `PIKAFISH_POOL` (số tiến trình Pikafish chạy song song, mặc định ≤ 4),
`PIKAFISH_HASH_MB` (mặc định 64), `PIKAFISH_DIR`, `ENGINE_BROWSER=0` (tắt header COOP/COEP → không chạy
Fairy-Stockfish trên trình duyệt, mọi nước đi do Pikafish trên server tính).

Fairy-Stockfish và Pikafish dùng giấy phép **GPL-3.0** (mã nguồn: https://github.com/fairy-stockfish/fairy-stockfish.wasm,
https://github.com/official-pikafish/Pikafish). Web gửi file Fairy-Stockfish xuống trình duyệt nên giữ nguyên
file giấy phép đi kèm và ghi nguồn như trên.

Chơi với người cùng mạng Wi‑Fi: gửi họ địa chỉ `http://<IP-máy-bạn>:3000`
(xem IP bằng `ipconfig getifaddr en0` trên macOS).

## Trang quản trị
Mở http://localhost:3000/admin

- **Mật khẩu:** mặc định không cần. Khi đưa lên mạng, đặt biến môi trường `ADMIN_PASSWORD` để
  trang quản trị yêu cầu đăng nhập (nếu không, ai biết đường dẫn /admin cũng vào được).
- Cùng giao diện Tượng Kỳ với trang chơi, menu trái chia theo chức năng của web:
  - **Tổng quan**: kỳ thủ, đang online, ván đang diễn ra, đang tìm trận, ván đã chơi, xu đang lưu hành;
    trận đấu đang diễn ra, kỳ thủ online, top Elo, kỳ thủ mới, góp ý mới nhất (tự cập nhật mỗi 5 giây)
  - **Phòng chơi**: phân loại Xếp hạng / Tranh xu (mức đặt) / Giải đấu / Ghép trận / Phòng riêng, nhịp chơi, người xem;
    vào xem (không chiếm ghế) hoặc đóng phòng
  - **Giải đấu**: tạo / sửa giải (thể thức, số người, số vòng, giờ bắt đầu, nhịp, lệ phí, thưởng top 3, thời gian
    check-in & chờ vào bàn), bắt đầu ngay, huỷ (hoàn lệ phí), xoá; trang chi tiết có bảng điểm, các vòng, link xem bàn
  - **Kỳ thủ**: tìm/lọc/sắp xếp (Elo, xu, uy tín, cờ thế…); trang chi tiết: hồ sơ, biểu đồ Elo, lịch sử ván + biên bản,
    đối thủ thường gặp; đổi tên, chỉnh Elo / xu / uy tín, đặt lại mật khẩu, mời ra khỏi phòng, đăng xuất mọi thiết bị,
    khoá/mở khoá, xoá tài khoản. Dữ liệu trong `data/db.json`
  - **Bảng xếp hạng**: Elo, Danh vọng mùa, chuỗi thắng, Tranh xu, cờ thế — giống trang Xếp hạng của người chơi
  - **Cờ thế**: bày thế cờ, ghi lời giải bằng cách đi quân (server kiểm tra hợp lệ), chọn độ khó & chủ đề, ẩn/hiện, xoá
  - **Góp ý**: góp ý và **báo cáo kỳ thủ** (lọc riêng, có link tới tài khoản bị báo cáo)
  - **Chế độ chơi & xu**: nhịp cố định & phí / thưởng của Xếp hạng; các nhịp (theo nhóm Cờ chớp, Cờ nhanh…) và mức đặt
    của Tranh xu; xu tặng khi tạo tài khoản, thưởng đăng nhập, cờ thế, đấu máy. Lưu là áp dụng ngay cho ván mới và trang
    chơi của mọi người (không cần tải lại); lưu ở `data/economy.json` hoặc khoá `economy` trong bảng settings của Supabase
  - **Bàn cờ & quân cờ**: giao diện mặc định ("Theo Tượng Kỳ" trong Túi đồ) — chọn/tải ảnh bàn cờ (tự nhận diện lưới 9×10),
    kiểu quân, font và màu chữ; lưu là áp dụng ngay. Ảnh lưu trong `data/uploads/`, cấu hình trong `data/theme.json`

## Kiểm thử luật cờ
```bash
npm test
```

## Lưu dữ liệu trên Supabase
Mặc định dữ liệu lưu thành file trong `data/`. Muốn lưu trên Supabase (Postgres + Storage):

1. Tạo dự án tại https://supabase.com.
2. Mở **SQL Editor → New query**, dán toàn bộ `supabase/schema.sql` rồi bấm **Run** (tạo 8 bảng `tk_*`
   và bucket ảnh `tuongky`). Chạy lại nhiều lần cũng không sao. **Mỗi lần cập nhật code thêm cột mới
   (vd bản có giải đấu / bạn bè / túi đồ) hãy chạy lại file này** — server sẽ báo cột nào còn thiếu nếu quên.
3. Sao chép `.env.example` thành `.env`, điền từ **Project Settings → API**:
   `SUPABASE_URL` (Project URL) và `SUPABASE_SERVICE_ROLE_KEY` (khoá **service_role** — bí mật, chỉ đặt ở server).
4. (Nếu đã có dữ liệu cũ trong `data/`) chạy `npm run migrate:supabase` để chuyển tài khoản, ván đấu, góp ý,
   cờ thế, giao diện bàn cờ và ảnh lên Supabase.
5. `npm start` — dòng log `Dữ liệu: Supabase (...)` và thanh trên trang quản trị cho biết đang dùng Supabase.

Cách hoạt động: server nạp toàn bộ dữ liệu khi khởi động, giữ trong bộ nhớ, mỗi lần có thay đổi chỉ ghi các dòng
bị đổi (mất mạng thì tự thử lại sau 5 giây; lỗi hiện trên thanh trên trang quản trị). Ảnh đại diện và ảnh bàn cờ
lưu trong bucket công khai. Các bảng bật RLS và không có policy, nên khoá anon không đọc được dữ liệu.
Chạy **một** server cho mỗi dự án Supabase (dữ liệu được giữ trong bộ nhớ của server đó). Cần Node.js ≥ 20.12.

## Đưa lên mạng (chơi với bạn ở xa)
Cần dịch vụ hỗ trợ Node.js + WebSocket, ví dụ Render, Railway, Fly.io:
1. Đưa thư mục này lên GitHub.
2. Tạo Web Service mới từ repo, lệnh build `npm install && npm run setup:engine`, lệnh chạy `npm start`.
3. Server tự dùng biến môi trường `PORT` do dịch vụ cấp. Đặt thêm `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
   và `ADMIN_PASSWORD` trong phần Environment của dịch vụ (không cần file `.env`).

Lưu ý: phòng chơi lưu trong bộ nhớ, khởi động lại server sẽ mất các ván đang chơi. Nếu không dùng Supabase,
dữ liệu người chơi nằm trong thư mục `data/` — khi đưa lên mạng nhớ dùng ổ đĩa lưu trữ lâu dài
(hoặc biến `DATA_DIR`) để không mất dữ liệu.

## Cấu trúc
- `server.js` — quản lý phòng, kiểm tra nước đi, đồng bộ trạng thái
- `users.js` — người chơi, thống kê, xu, bạn bè, thông báo, túi đồ, nhiệm vụ, mùa giải; `puzzles.js` — cờ thế;
  `theme.js` — giao diện bàn cờ mặc định; `tournaments.js` — giải đấu (ghép cặp, vòng đấu, trao thưởng)
- `public/catalog.js` — danh mục vật phẩm & quy tắc xu (dùng chung server và trình duyệt)
- `storage/` — nơi lưu: `file.js` (data/) hoặc `supabase.js` (khi có SUPABASE_URL); `supabase/schema.sql` — tạo bảng
- `admin.js` — API trang quản trị; `admin/` — giao diện quản trị
- `public/xiangqi.js` — luật cờ (dùng chung cho server và trình duyệt)
- `public/engine-pro.js` — chọn engine cho Đấu máy / Gợi ý / Phân tích; `engine-server.js` — Pikafish trên server
  (`POST /api/engine`); `scripts/setup-pikafish.js` — tải Pikafish; `public/engine.js` — engine cũ (dự phòng)
- `public/app.js`, `index.html`, `style.css` — giao diện
