# DEVHAI FACE AI

Demo nhận diện khuôn mặt chạy **100% client-side** bằng `face-api.js`, webcam + Supabase Free.

- Không Flask
- Không Node backend
- Không VPS
- Không OpenRouter
- Camera frame không upload lên server
- Supabase chỉ lưu ảnh đăng ký + face descriptor 128 chiều
- Deploy được trên GitHub Pages

## Cấu trúc

```text
devhai-face/
├── index.html
├── admin.html
├── app.js
├── admin.js
├── style.css
├── models/
│   └── README.txt
└── README.md
```

## 1. SQL Supabase

Mở **Supabase Dashboard → SQL Editor → New query** rồi chạy:

```sql
create extension if not exists pgcrypto;

create table if not exists public.faces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  age integer not null check (age between 1 and 120),
  image_path text not null,
  descriptor jsonb not null,
  created_at timestamptz not null default now()
);

alter table public.faces enable row level security;

grant select, insert, delete on table public.faces to anon;
grant all on table public.faces to service_role;

drop policy if exists "faces anon select" on public.faces;
create policy "faces anon select"
on public.faces
for select
to anon
using (true);

drop policy if exists "faces anon insert" on public.faces;
create policy "faces anon insert"
on public.faces
for insert
to anon
with check (
  jsonb_typeof(descriptor) = 'array'
  and jsonb_array_length(descriptor) = 128
);

drop policy if exists "faces anon delete" on public.faces;
create policy "faces anon delete"
on public.faces
for delete
to anon
using (true);

-- Storage policy cho bucket "faces".
-- Bucket phải được tạo trong Storage trước hoặc bằng INSERT bên dưới.

insert into storage.buckets (id, name, public)
values ('faces', 'faces', true)
on conflict (id) do update set public = true;

drop policy if exists "faces storage anon select" on storage.objects;
create policy "faces storage anon select"
on storage.objects
for select
to anon
using (bucket_id = 'faces');

drop policy if exists "faces storage anon insert" on storage.objects;
create policy "faces storage anon insert"
on storage.objects
for insert
to anon
with check (bucket_id = 'faces');

drop policy if exists "faces storage anon delete" on storage.objects;
create policy "faces storage anon delete"
on storage.objects
for delete
to anon
using (bucket_id = 'faces');
```

### Cảnh báo bảo mật

SQL trên cố ý cho role `anon` quyền thêm/xóa để `/admin.html` chạy trên một website tĩnh không có backend/auth.

**Chỉ phù hợp project TEST.** Nếu public site thật, bất kỳ ai mở `admin.html` và có anon key đều có thể sửa database. Với hệ thống thật hãy thêm Supabase Auth và đổi policy INSERT/DELETE thành `authenticated`.

Không bao giờ đặt `service_role` key vào `app.js` hoặc `admin.js`.

## 2. Tạo Storage bucket

Cách bằng Dashboard:

1. Vào **Storage**.
2. Bấm **New bucket**.
3. Tên bucket: `faces`.
4. Bật **Public bucket** để Admin hiển thị ảnh bằng public URL.
5. Create.

Nếu đã chạy SQL ở trên, bucket cũng sẽ được tạo/đặt Public tự động.

Public bucket chỉ làm việc **đọc ảnh bằng URL** trở nên public. Upload/xóa vẫn phụ thuộc RLS policy.

## 3. Cấu hình Supabase URL + anon key

Vào Supabase project → **Settings / API** (hoặc mục API Keys tương ứng) rồi lấy:

- Project URL
- anon / publishable key dùng cho client

Trong **cả `app.js` và `admin.js`**, sửa:

```js
const SUPABASE_URL = "https://YOUR_PROJECT.supabase.co";
const SUPABASE_ANON_KEY = "YOUR_ANON_KEY";
```

Không dùng `service_role`.

## 4. Tải model face-api.js

Project dùng đúng 3 model:

- Tiny Face Detector
- Face Landmark 68
- Face Recognition

Trong thư mục `models/` phải có đủ **7 file**:

```text
tiny_face_detector_model-weights_manifest.json
tiny_face_detector_model-shard1

face_landmark_68_model-weights_manifest.json
face_landmark_68_model-shard1

face_recognition_model-weights_manifest.json
face_recognition_model-shard1
face_recognition_model-shard2
```

Nguồn chính thức trong repo face-api.js:

`https://github.com/justadudewhohacks/face-api.js/tree/master/weights`

Tải đúng 7 file trên và đặt trực tiếp trong `models/`.

**Quan trọng:** manifest `.json` và shard phải nằm cùng thư mục.

Code dùng:

```js
const MODEL_URL = "./models";
```

nên chạy đúng cả localhost lẫn GitHub Pages dạng subfolder repository.

## 5. Chạy local

Không mở trực tiếp bằng `file:///.../index.html`, vì model/camera có thể bị browser chặn.

Dùng **VS Code Live Server**:

1. Mở folder `devhai-face` trong VS Code.
2. Cài extension **Live Server**.
3. Right click `index.html` → **Open with Live Server**.
4. Trình duyệt sẽ mở một địa chỉ `http://localhost:...`.

Project không có Python server, Node backend hay API server riêng.

## 6. Deploy GitHub Pages

1. Tạo repository, ví dụ `devhai-face`.
2. Upload toàn bộ file, bao gồm đủ model trong `models/`.
3. Commit/push lên branch `main`.
4. GitHub repository → **Settings → Pages**.
5. Source: **Deploy from a branch**.
6. Branch: `main`, folder `/ (root)`.
7. Save.
8. Mở URL Pages do GitHub cấp.

GitHub Pages dùng HTTPS nên `getUserMedia()` có thể xin webcam bình thường.

## 7. Thêm người trong Admin

Mở:

```text
/admin.html
```

Ví dụ GitHub Pages:

```text
https://username.github.io/devhai-face/admin.html
```

Sau đó:

1. Nhập tên.
2. Nhập tuổi.
3. Chọn ảnh JPG/PNG/WEBP.
4. Ảnh nên sáng, rõ, mặt tương đối chính diện.
5. Ảnh phải có đúng **1 khuôn mặt**.
6. Admin chạy face-api.js trên trình duyệt và tạo descriptor 128 chiều.
7. Bấm **TẠO DESCRIPTOR & LƯU**.
8. Ảnh được upload vào bucket `faces`.
9. Descriptor + name + age + image_path được insert vào table `faces`.
10. Mở `/index.html`; camera sẽ tải database và so sánh liên tục.

Nếu xóa trong Admin, code sẽ:
1. Xóa ảnh qua Supabase Storage API.
2. Xóa row tương ứng trong `faces`.

## Matching / confidence

- Distance: `faceapi.euclideanDistance()`
- Threshold mặc định: `0.55`
- Chỉ distance `<= 0.55` mới được coi là match.
- Confidence **không random**.
- Code quy đổi trực tiếp từ Euclidean distance về phần trăm.
- Không match: `UNKNOWN - -- - 0%`

Bạn có thể chỉnh:

```js
const MATCH_THRESHOLD = 0.55;
```

Gợi ý:
- `0.50`: chặt hơn, ít nhận nhầm hơn nhưng dễ bỏ sót.
- `0.55`: cân bằng cho demo.
- `0.60`: dễ match hơn nhưng tăng nguy cơ nhận nhầm.

## Camera và dữ liệu

Frame webcam chỉ đi qua:
- `<video>`
- face-api.js / TensorFlow.js trong browser
- `<canvas>` overlay

Code không upload frame camera, screenshot hoặc video lên Supabase.

Supabase chỉ chứa ảnh mà Admin chủ động chọn khi đăng ký người.

## Lưu ý về dữ liệu sinh trắc học

Face descriptor là dữ liệu sinh trắc học nhạy cảm. Chỉ đăng ký khuôn mặt khi có quyền/đồng ý phù hợp, và không dùng bộ policy demo này cho hệ thống thật.
