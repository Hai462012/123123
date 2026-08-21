/* =========================================================
   DEVHAI FACE AI - Admin
   Chỉ thay 2 giá trị SUPABASE_URL và SUPABASE_ANON_KEY.
   Không bao giờ đặt service_role key vào code frontend.
   ========================================================= */

const SUPABASE_URL = "YOUR_SUPABASE_URL";
const SUPABASE_ANON_KEY = "YOUR_SUPABASE_ANON_KEY";

const MODEL_URL = "./models";
const STORAGE_BUCKET = "faces";

const form = document.getElementById("addFaceForm");
const nameInput = document.getElementById("nameInput");
const ageInput = document.getElementById("ageInput");
const imageInput = document.getElementById("imageInput");
const addFaceBtn = document.getElementById("addFaceBtn");
const formMessage = document.getElementById("formMessage");
const imagePreview = document.getElementById("imagePreview");
const previewWrap = document.getElementById("previewWrap");
const previewCanvas = document.getElementById("previewCanvas");
const faceList = document.getElementById("faceList");
const refreshListBtn = document.getElementById("refreshListBtn");
const adminModelStatus = document.getElementById("adminModelStatus");
const configWarning = document.getElementById("configWarning");

let supabaseClient = null;
let modelsReady = false;
let previewObjectUrl = null;
let currentPreviewDescriptor = null;

function hasSupabaseConfig() {
  return (
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes("YOUR_SUPABASE") &&
    !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")
  );
}

function initSupabase() {
  if (!hasSupabaseConfig()) {
    configWarning.classList.remove("hidden");
    return;
  }

  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function setFormMessage(message, type = "") {
  formMessage.textContent = message;
  formMessage.className = `form-message ${type}`.trim();
}

function updateSubmitState() {
  addFaceBtn.disabled = !(
    modelsReady &&
    supabaseClient &&
    nameInput.value.trim() &&
    ageInput.value &&
    imageInput.files?.[0] &&
    currentPreviewDescriptor
  );
}

async function loadModels() {
  adminModelStatus.innerHTML =
    '<span class="status-dot"></span> Đang tải Tiny Face Detector...';

  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

  adminModelStatus.innerHTML =
    '<span class="status-dot"></span> Đang tải Face Landmark...';
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

  adminModelStatus.innerHTML =
    '<span class="status-dot"></span> Đang tải Face Recognition...';
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

  modelsReady = true;
  adminModelStatus.innerHTML =
    '<span class="status-dot active"></span> AI MODEL READY';

  updateSubmitState();
}

function drawPreviewBox(img, detection) {
  const rect = img.getBoundingClientRect();
  const width = Math.max(1, rect.width);
  const height = Math.max(1, rect.height);
  const dpr = Math.max(1, Math.min(devicePixelRatio || 1, 2));

  previewCanvas.width = Math.round(width * dpr);
  previewCanvas.height = Math.round(height * dpr);
  previewCanvas.style.width = `${width}px`;
  previewCanvas.style.height = `${height}px`;

  const context = previewCanvas.getContext("2d");
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  // Admin preview dùng object-fit: contain.
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const scale = Math.min(width / iw, height / ih);
  const renderW = iw * scale;
  const renderH = ih * scale;
  const offsetX = (width - renderW) / 2;
  const offsetY = (height - renderH) / 2;

  const box = detection.box;
  const x = box.x * scale + offsetX;
  const y = box.y * scale + offsetY;
  const w = box.width * scale;
  const h = box.height * scale;

  context.strokeStyle = "#00ff8a";
  context.lineWidth = 3;
  context.shadowColor = "rgba(0,255,138,.8)";
  context.shadowBlur = 10;
  context.strokeRect(x, y, w, h);
}

async function analyzeSelectedImage() {
  currentPreviewDescriptor = null;
  updateSubmitState();

  const file = imageInput.files?.[0];

  if (!file) {
    previewWrap.classList.add("hidden");
    setFormMessage("");
    return;
  }

  if (!modelsReady) {
    setFormMessage("AI model chưa tải xong.", "warning");
    return;
  }

  if (!file.type.startsWith("image/")) {
    setFormMessage("File đã chọn không phải ảnh hợp lệ.", "error");
    return;
  }

  if (file.size > 8 * 1024 * 1024) {
    setFormMessage("Ảnh quá lớn. Hãy dùng ảnh nhỏ hơn 8 MB.", "error");
    return;
  }

  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
  previewObjectUrl = URL.createObjectURL(file);
  imagePreview.src = previewObjectUrl;
  previewWrap.classList.remove("hidden");

  await new Promise((resolve, reject) => {
    imagePreview.onload = resolve;
    imagePreview.onerror = reject;
  });

  setFormMessage("Đang tìm khuôn mặt và tạo descriptor...", "working");

  try {
    const image = await faceapi.bufferToImage(file);

    const results = await faceapi
      .detectAllFaces(
        image,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.5
        })
      )
      .withFaceLandmarks()
      .withFaceDescriptors();

    if (results.length === 0) {
      setFormMessage(
        "Không tìm thấy khuôn mặt. Hãy dùng ảnh sáng, rõ và nhìn tương đối chính diện.",
        "error"
      );
      return;
    }

    if (results.length > 1) {
      setFormMessage(
        `Ảnh có ${results.length} khuôn mặt. Hãy dùng ảnh chỉ có đúng 1 người.`,
        "error"
      );
      return;
    }

    currentPreviewDescriptor = Array.from(results[0].descriptor);
    drawPreviewBox(imagePreview, results[0].detection);

    setFormMessage(
      `Đã tạo descriptor ${currentPreviewDescriptor.length} chiều. Sẵn sàng lưu.`,
      "success"
    );
  } catch (error) {
    console.error(error);
    setFormMessage("Không thể xử lý ảnh này.", "error");
  }

  updateSubmitState();
}

function safeFileExtension(file) {
  const map = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };

  return map[file.type] || "jpg";
}

async function addPerson(event) {
  event.preventDefault();

  if (!supabaseClient) {
    setFormMessage("Supabase chưa được cấu hình.", "error");
    return;
  }

  if (!modelsReady || !currentPreviewDescriptor) {
    setFormMessage("Hãy chọn một ảnh có đúng 1 khuôn mặt trước.", "error");
    return;
  }

  const name = nameInput.value.trim();
  const age = Number.parseInt(ageInput.value, 10);
  const file = imageInput.files?.[0];

  if (!name || !Number.isInteger(age) || age < 1 || age > 120 || !file) {
    setFormMessage("Vui lòng nhập tên, tuổi và chọn ảnh hợp lệ.", "error");
    return;
  }

  addFaceBtn.disabled = true;
  refreshListBtn.disabled = true;
  setFormMessage("Đang upload ảnh lên Supabase Storage...", "working");

  const filePath = `${crypto.randomUUID()}.${safeFileExtension(file)}`;

  try {
    const { error: uploadError } = await supabaseClient.storage
      .from(STORAGE_BUCKET)
      .upload(filePath, file, {
        cacheControl: "3600",
        upsert: false,
        contentType: file.type
      });

    if (uploadError) throw uploadError;

    setFormMessage("Đang lưu descriptor vào database...", "working");

    const { error: insertError } = await supabaseClient
      .from("faces")
      .insert({
        name,
        age,
        image_path: filePath,
        descriptor: currentPreviewDescriptor
      });

    if (insertError) {
      // Rollback ảnh nếu insert DB thất bại.
      await supabaseClient.storage.from(STORAGE_BUCKET).remove([filePath]);
      throw insertError;
    }

    setFormMessage(`Đã thêm ${name} thành công.`, "success");

    form.reset();
    currentPreviewDescriptor = null;
    previewWrap.classList.add("hidden");

    if (previewObjectUrl) {
      URL.revokeObjectURL(previewObjectUrl);
      previewObjectUrl = null;
    }

    await loadPeople();
  } catch (error) {
    console.error(error);
    setFormMessage(error?.message || "Không thể thêm người.", "error");
  } finally {
    refreshListBtn.disabled = false;
    updateSubmitState();
  }
}

async function deletePerson(person) {
  if (!supabaseClient) return;

  const confirmed = window.confirm(
    `Xóa "${person.name}"?\n\nẢnh trong Storage và dữ liệu descriptor sẽ bị xóa.`
  );

  if (!confirmed) return;

  setFormMessage(`Đang xóa ${person.name}...`, "working");

  try {
    if (person.image_path) {
      const { error: storageError } = await supabaseClient.storage
        .from(STORAGE_BUCKET)
        .remove([person.image_path]);

      if (storageError) throw storageError;
    }

    const { error: dbError } = await supabaseClient
      .from("faces")
      .delete()
      .eq("id", person.id);

    if (dbError) throw dbError;

    setFormMessage(`Đã xóa ${person.name}.`, "success");
    await loadPeople();
  } catch (error) {
    console.error(error);
    setFormMessage(error?.message || "Không thể xóa dữ liệu.", "error");
  }
}

function createPersonCard(person) {
  const card = document.createElement("article");
  card.className = "person-card";

  const imageBox = document.createElement("div");
  imageBox.className = "person-image";

  if (person.image_path) {
    const { data } = supabaseClient.storage
      .from(STORAGE_BUCKET)
      .getPublicUrl(person.image_path);

    const img = document.createElement("img");
    img.src = data.publicUrl;
    img.alt = `Khuôn mặt ${person.name}`;
    img.loading = "lazy";
    imageBox.appendChild(img);
  } else {
    imageBox.textContent = "NO IMAGE";
  }

  const meta = document.createElement("div");
  meta.className = "person-meta";

  const name = document.createElement("strong");
  name.textContent = person.name;

  const details = document.createElement("span");
  const descriptorLength = Array.isArray(person.descriptor)
    ? person.descriptor.length
    : "?";
  details.textContent = `${person.age} tuổi • descriptor ${descriptorLength}D`;

  const created = document.createElement("small");
  created.textContent = person.created_at
    ? new Date(person.created_at).toLocaleString("vi-VN")
    : "";

  meta.append(name, details, created);

  const actions = document.createElement("div");
  actions.className = "person-actions";

  const deleteBtn = document.createElement("button");
  deleteBtn.type = "button";
  deleteBtn.className = "btn danger";
  deleteBtn.textContent = "XÓA";
  deleteBtn.addEventListener("click", () => deletePerson(person));

  actions.appendChild(deleteBtn);
  card.append(imageBox, meta, actions);

  return card;
}

async function loadPeople() {
  if (!supabaseClient) {
    faceList.innerHTML =
      '<div class="empty-state">Cấu hình Supabase để xem danh sách.</div>';
    return;
  }

  faceList.innerHTML = '<div class="empty-state">Đang tải dữ liệu...</div>';

  const { data, error } = await supabaseClient
    .from("faces")
    .select("id,name,age,image_path,descriptor,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error(error);
    faceList.innerHTML =
      '<div class="empty-state error-text">Không thể tải database.</div>';
    return;
  }

  faceList.innerHTML = "";

  if (!data?.length) {
    faceList.innerHTML =
      '<div class="empty-state">Chưa có khuôn mặt nào được đăng ký.</div>';
    return;
  }

  for (const person of data) {
    faceList.appendChild(createPersonCard(person));
  }
}

async function boot() {
  initSupabase();

  nameInput.addEventListener("input", updateSubmitState);
  ageInput.addEventListener("input", updateSubmitState);
  imageInput.addEventListener("change", analyzeSelectedImage);
  form.addEventListener("submit", addPerson);
  refreshListBtn.addEventListener("click", loadPeople);

  try {
    await loadModels();
  } catch (error) {
    console.error(error);
    adminModelStatus.innerHTML =
      '<span class="status-dot"></span> MODEL ERROR';
    setFormMessage(
      "Không tải được AI model. Kiểm tra thư mục /models và chạy bằng HTTP/HTTPS.",
      "error"
    );
  }

  await loadPeople();
  updateSubmitState();
}

window.addEventListener("beforeunload", () => {
  if (previewObjectUrl) URL.revokeObjectURL(previewObjectUrl);
});

boot();
