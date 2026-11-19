# Edit Video Affiliate

Phần mềm sửa video affiliate chạy ngay trên trình duyệt — không cần cài đặt, không cần build.
Luồng làm việc: **Nhập ảnh → Storyboard → Timeline & nhạc → Xuất video 9:16**.

## Dùng ngay

Mở app trên GitHub Pages (xem mục bên dưới), hoặc tải repo về rồi mở file `index.html`
bằng trình duyệt. App dùng HTML/CSS/JavaScript thuần, không cần máy chủ riêng.

## Cách làm một video

1. **Nhập ảnh** — kéo thả nhiều ảnh vào khung, hoặc bấm để chọn file, hoặc dán link ảnh.
   Ảnh lưu trong trình duyệt (IndexedDB) nên tải lại trang vẫn còn. Bấm **＋ Storyboard**
   trên một ảnh để đưa ảnh đó vào cảnh. Mục **Tìm / tạo thêm ảnh** cho phép tìm ảnh
   stock trên Pexels và tạo ảnh từ mô tả bằng OpenRouter (cần nhập API key trước).
2. **Storyboard** — mỗi cảnh gồm ảnh + chữ/thoại + thời lượng (giây). Kéo thả để đổi
   thứ tự, hoặc dùng nút ↑ ↓. Sửa chữ và thời lượng trực tiếp trên thẻ cảnh.
3. **Timeline & nhạc** — xem trước video trên khung dọc 9:16 với hiệu ứng pan/zoom
   (Ken Burns). Bấm vào một clip trên timeline để sửa thời lượng và chữ hiển thị.
   Tải file nhạc mp3 lên làm nhạc nền, chỉnh âm lượng.
4. **Xuất video** — nhập thẻ sản phẩm (tên món, giá gốc, giá khuyến mãi, link Shopee),
   bấm **Xuất video .webm**. App tạo caption Facebook kèm theo, có nút sao chép
   và tải file `.txt`.

## Bật GitHub Pages

1. Đẩy code lên repo GitHub (branch `main`).
2. Vào repo → **Settings** → **Pages**.
3. Ở mục **Build and deployment**, chọn **Deploy from a branch**.
4. Chọn branch `main` và thư mục `/ (root)`, bấm **Save**.
5. Chờ khoảng 1 phút, mở link Pages mà GitHub đưa (dạng
   `https://<tên-tài-khoản>.github.io/<tên-repo>/`).

## Nhập API key (mục 🔌 Kết nối)

- **AI Lab — Videoslash**: nhập key Videoslash, base URL mặc định
  `https://www.videoslash.com/api`. Dùng cho công cụ video: upscale, lipsync,
  dịch video, reshoot. Lưu ý: cần gói đăng ký Videoslash đang hoạt động thì
  công cụ mới chạy được.
- **Suno — nhạc nền**: Suno chưa có API chính thức mở rộng, nên app nối qua nhà
  cung cấp bên thứ ba. Nhập base URL của nhà cung cấp bạn dùng (gợi ý: TTAPI,
  APIMart, Kunavo — mặc định sẵn `https://api.ttapi.io`) + key của họ.
- **OpenRouter — tạo ảnh**: nhập key OpenRouter (`sk-or-...`), dùng để tạo ảnh
  từ mô tả. Model mặc định: `google/gemini-2.5-flash-image`, đổi được trong
  ô tạo ảnh.
- **Pexels — tìm ảnh stock**: nhập key Pexels miễn phí (lấy tại pexels.com/api).

> Ghi chú về tên gọi: "Avid Lab" và "Zuno" là do người dùng đọc bằng giọng nói —
> app đoán là **AI Lab (Videoslash)** và **Suno (nhạc)**. Nếu đoán sai, bạn chỉ
> cần sửa lại base URL trong mục Kết nối là dùng được đúng dịch vụ bạn muốn.

## Lưu ý quan trọng

- **Video xuất ra dạng WebM (.webm)**, khung dọc 9:16, 720×1280, 30fps.
  File WebM đăng trực tiếp lên Facebook được. Quá trình xuất chạy theo thời
  gian thực — video dài 30 giây thì mất khoảng 30 giây để xuất.
- **API key chỉ lưu trong trình duyệt của bạn** (localStorage). Key không gửi
  đi đâu ngoài API của chính dịch vụ đó khi bạn bấm dùng. Không bao giờ dán
  key vào chat hay gửi cho ai. Xóa dữ liệu trình duyệt thì key cũng mất theo.
- Ảnh và nhạc lưu bằng IndexedDB trong trình duyệt; thông tin dự án (cảnh,
  chữ, thời lượng, sản phẩm) lưu bằng localStorage. Mở app trên trình duyệt
  khác hoặc máy khác thì phải nhập lại ảnh/key.
- Nhạc nền cháy vào video khi xuất nếu trình duyệt hỗ trợ (Chrome, Edge bản
  mới hỗ trợ tốt). Trên trình duyệt không hỗ trợ, video xuất ra sẽ không có
  nhạc và app sẽ báo cho bạn biết.
- Caption Facebook tự tạo luôn có hashtag `#xuhuong #cute #baby` và link
  Shopee TopGia `https://s.shopee.vn/60SurkajtJ`.

## Hạn chế đã biết

- Hiệu ứng chuyển động trong bản xem trước và video xuất là pan/zoom trên ảnh
  tĩnh (Ken Burns). Muốn nhân vật đi lại thật thì cần clip AI tạo từ prompt,
  app này chỉ ghép ảnh tĩnh thành video.
- Xuất video chạy thời gian thực nên video càng dài càng mất thời gian xuất.
- Tìm ảnh Pexels và tạo ảnh OpenRouter cần mạng và key hợp lệ; khi chưa có key,
  nút sẽ dẫn bạn tới mục Kết nối thay vì báo lỗi khó hiểu.
