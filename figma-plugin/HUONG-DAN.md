# Plugin Figma: dựng màn hình Tượng Kỳ

Plugin dựng các màn hình sửa được vào file Figma
https://www.figma.com/design/ZnOZXhzrJmLWmxfHIloXRp, trang **"✏️ Thiết kế sửa được"**.
Plugin chạy ngay trong app Figma trên máy nên không tốn lượt của gói Figma.

## Chạy plugin

1. Mở **app Figma trên máy tính**. Bản trên trình duyệt không chạy được plugin tự làm.
2. Mở file Tượng Kỳ.
3. **Đã import plugin trước đó?** Vẫn phải import lại một lần vì plugin vừa có thêm menu mới:
   vào **Plugins → Development → Import plugin from manifest…** rồi chọn `figma-plugin/manifest.json`.
4. Vào **Plugins → Development → Tượng Kỳ – Dựng màn hình**, rồi chọn:
   - **Dựng giao diện điện thoại (mobile)**: thêm section **"✏️ Giao diện điện thoại (390px)"** gồm 19 màn.
     Chạy lại lệnh này thì chỉ section mobile được dựng lại. Các màn desktop (kể cả màn bạn đã sửa) không bị động tới.
   - **Dựng giao diện máy tính (desktop)**: dựng 24 màn desktop. Nếu trong file đã có các section desktop, lệnh này **từ chối chạy**
     để không ghi đè lên màn bạn đã sửa. Muốn dựng lại từ đầu thì tự xoá 3 section ✏️ desktop trước.

## Giao diện điện thoại (19 màn, rộng 390px)

- Trang chủ (đã đăng nhập / khách), Menu mở.
- Chơi (cờ phướn cuộn ngang), Xếp hạng, Chơi nhanh, Bàn đấu, Chơi với bạn.
- AI: Phân tích, Đấu với AI, Cờ thế.
- Bảng xếp hạng, Túi đồ, Cửa hàng, Hồ sơ.
- Trong trận (đấu máy / online có đồng hồ), Kết quả Thua / Thắng.

Các màn dựng theo web hiện tại ở khổ điện thoại và đã có những chỉnh sửa bạn làm trên Figma ngày 14/10:
- thẻ bàn đấu;
- 3 ô chọn nhịp chơi;
- bỏ nút "Đi lại";
- menu hồ sơ chia 2 cột.

**Thanh trên mobile** là một component đặt ở đầu section: sửa ở component đó thì mọi màn mobile đổi theo.

## Dùng lại những gì có sẵn trong file

- **Bộ màu "Tượng Kỳ · Màu"**: phần lớn màu được gắn với biến.
- **Thành phần dùng chung**: Menu trái, Thanh trên, Nút, Nhãn đỏ, Quân cờ, Bàn cờ, Cờ phướn, cùng 55 biểu tượng.
- Mỗi quân trên bàn là một instance của "Quân cờ": chọn quân rồi đổi **Màu / Quân** ở panel bên phải.

## Gặp lỗi?

- Hiện *"Thiếu thành phần…"*: plugin đang chạy trong file khác, hoặc component gốc đã bị xoá.
- Có màn bị **khung đỏ "Không dựng được màn này"**: trong khung có ghi lỗi. Gửi nội dung lỗi để sửa plugin.
- Thiếu phông Be Vietnam Pro / Noto Serif: plugin tự đổi sang phông Inter.

Bảng xếp hạng, Hồ sơ, Bàn đấu và phần trò chuyện dùng **dữ liệu mẫu** để thấy rõ bố cục khi có dữ liệu.
