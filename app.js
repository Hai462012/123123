/* =========================================================
   DEVHAI FACE AI - Camera
   Chỉ thay 2 giá trị SUPABASE_URL và SUPABASE_ANON_KEY.
   Không bao giờ đặt service_role key vào code frontend.
   ========================================================= */

const SUPABASE_URL = "https://zxoisaiycernjzerhaac.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_6thMjI7oZHyCEBCU4FSKbw_yXro0nwZ";

const MODEL_URL = "./models";
const MATCH_THRESHOLD = 0.55;
const DATABASE_REFRESH_MS = 30_000;

const video = document.getElementById("video");
const overlay = document.getElementById("overlay");
const cameraStage = document.getElementById("cameraStage");
const ctx = overlay.getContext("2d");

const loadingPanel = document.getElementById("loadingPanel");
const loadingTitle = document.getElementById("loadingTitle");
const loadingText = document.getElementById("loadingText");
const errorPanel = document.getElementById("errorPanel");
const errorTitle = document.getElementById("errorTitle");
const errorText = document.getElementById("errorText");
const retryCameraBtn = document.getElementById("retryCameraBtn");
const toggleCameraBtn = document.getElementById("toggleCameraBtn");
const cameraButtonText = document.getElementById("cameraButtonText");
const fullscreenBtn = document.getElementById("fullscreenBtn");
const aiStatus = document.getElementById("aiStatus");
const aiDot = document.getElementById("aiDot");
const fpsValue = document.getElementById("fpsValue");

let supabaseClient = null;
let stream = null;
let modelsReady = false;
let cameraRunning = false;
let detectionBusy = false;
let detectionRaf = 0;
let registeredFaces = [];

let frameCounter = 0;
let fpsTimerStart = performance.now();

function hasSupabaseConfig() {
  return (
    SUPABASE_URL &&
    SUPABASE_ANON_KEY &&
    !SUPABASE_URL.includes("YOUR_SUPABASE") &&
    !SUPABASE_ANON_KEY.includes("YOUR_SUPABASE")
  );
}

function initSupabase() {
  if (!hasSupabaseConfig()) return;
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

function setAIStatus(text, active = false) {
  aiStatus.textContent = text;
  aiDot.classList.toggle("active", active);
}

function setLoading(title, text) {
  loadingTitle.textContent = title;
  loadingText.textContent = text;
  loadingPanel.classList.remove("hidden");
  errorPanel.classList.add("hidden");
}

function hideLoading() {
  loadingPanel.classList.add("hidden");
}

function showError(title, text) {
  errorTitle.textContent = title;
  errorText.textContent = text;
  errorPanel.classList.remove("hidden");
  loadingPanel.classList.add("hidden");
  setAIStatus("AI STANDBY", false);
}

async function loadModels() {
  setLoading("ĐANG TẢI AI MODEL", "Tiny Face Detector...");
  setAIStatus("AI LOADING", false);

  await faceapi.nets.tinyFaceDetector.loadFromUri(MODEL_URL);

  loadingText.textContent = "Face Landmark 68...";
  await faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL);

  loadingText.textContent = "Face Recognition...";
  await faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL);

  modelsReady = true;
}

async function loadFaceDatabase() {
  if (!supabaseClient) {
    registeredFaces = [];
    console.warn("DEVHAI: Supabase chưa được cấu hình.");
    return;
  }

  const { data, error } = await supabaseClient
    .from("faces")
    .select("id,name,age,descriptor,created_at")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("DEVHAI: Không đọc được database:", error);
    return;
  }

  registeredFaces = (data || [])
    .map((row) => {
      const descriptor = normalizeDescriptor(row.descriptor);
      if (!descriptor) return null;

      return {
        id: row.id,
        name: String(row.name ?? "UNKNOWN"),
        age: Number.isFinite(Number(row.age)) ? Number(row.age) : "--",
        descriptor
      };
    })
    .filter(Boolean);

  console.log(`DEVHAI: loaded ${registeredFaces.length} face(s).`);
}

function normalizeDescriptor(raw) {
  let value = raw;

  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!Array.isArray(value) || value.length !== 128) return null;

  const floats = Float32Array.from(value.map(Number));
  if (floats.some((n) => !Number.isFinite(n))) return null;
  return floats;
}

async function startCamera() {
  if (!modelsReady) {
    showError("AI CHƯA SẴN SÀNG", "Model nhận diện vẫn đang tải.");
    return;
  }

  if (!navigator.mediaDevices?.getUserMedia) {
    showError(
      "TRÌNH DUYỆT KHÔNG HỖ TRỢ CAMERA",
      "Hãy mở bằng trình duyệt hiện đại qua HTTPS hoặc localhost."
    );
    return;
  }

  if (cameraRunning) return;

  try {
    setLoading("ĐANG KHỞI ĐỘNG CAMERA", "Đang xin quyền truy cập webcam...");

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 }
      },
      audio: false
    });

    video.srcObject = stream;

    await new Promise((resolve) => {
      if (video.readyState >= 2 && video.videoWidth) {
        resolve();
        return;
      }

      video.addEventListener("loadedmetadata", resolve, { once: true });
    });

    await video.play();

    cameraRunning = true;
    cameraButtonText.textContent = "CAM ON";
    setAIStatus("AI ACTIVE", true);
    hideLoading();
    errorPanel.classList.add("hidden");

    resizeOverlay();
    cancelAnimationFrame(detectionRaf);
    detectionRaf = requestAnimationFrame(detectionLoop);
  } catch (error) {
    console.error(error);
    stopCamera();

    if (error?.name === "NotAllowedError" || error?.name === "SecurityError") {
      showError(
        "CAMERA BỊ TỪ CHỐI",
        "Hãy cho phép quyền camera trong cài đặt của trình duyệt rồi bấm THỬ LẠI."
      );
    } else if (error?.name === "NotFoundError" || error?.name === "DevicesNotFoundError") {
      showError(
        "KHÔNG TÌM THẤY CAMERA",
        "Thiết bị này không có webcam khả dụng hoặc webcam đang bị ngắt kết nối."
      );
    } else if (error?.name === "NotReadableError") {
      showError(
        "CAMERA ĐANG BẬN",
        "Một ứng dụng khác có thể đang sử dụng webcam."
      );
    } else {
      showError(
        "KHÔNG THỂ MỞ CAMERA",
        error?.message || "Hãy kiểm tra quyền camera và thử lại."
      );
    }
  }
}

function stopCamera() {
  cameraRunning = false;
  cameraButtonText.textContent = "CAM OFF";
  setAIStatus(modelsReady ? "AI STANDBY" : "AI LOADING", false);

  cancelAnimationFrame(detectionRaf);
  detectionRaf = 0;

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  video.srcObject = null;
  clearOverlay();
  fpsValue.textContent = "0";
  frameCounter = 0;
  fpsTimerStart = performance.now();
}

async function toggleCamera() {
  if (cameraRunning) stopCamera();
  else await startCamera();
}

function resizeOverlay() {
  const rect = cameraStage.getBoundingClientRect();
  const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));

  overlay.width = Math.round(rect.width * dpr);
  overlay.height = Math.round(rect.height * dpr);
  overlay.style.width = `${rect.width}px`;
  overlay.style.height = `${rect.height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function clearOverlay() {
  const rect = cameraStage.getBoundingClientRect();
  ctx.clearRect(0, 0, rect.width, rect.height);
}

function videoToStageBox(box) {
  const stageWidth = cameraStage.clientWidth;
  const stageHeight = cameraStage.clientHeight;
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;

  if (!sourceWidth || !sourceHeight) return null;

  // CSS video dùng object-fit: cover
  const scale = Math.max(stageWidth / sourceWidth, stageHeight / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  const offsetX = (stageWidth - renderedWidth) / 2;
  const offsetY = (stageHeight - renderedHeight) / 2;

  return {
    x: box.x * scale + offsetX,
    y: box.y * scale + offsetY,
    width: box.width * scale,
    height: box.height * scale
  };
}

function bestMatch(queryDescriptor) {
  if (!registeredFaces.length) {
    return {
      matched: false,
      name: "UNKNOWN",
      age: "--",
      distance: 1,
      confidence: 0
    };
  }

  let winner = null;
  let bestDistance = Infinity;

  for (const person of registeredFaces) {
    const distance = faceapi.euclideanDistance(queryDescriptor, person.descriptor);

    if (distance < bestDistance) {
      bestDistance = distance;
      winner = person;
    }
  }

  if (!winner || bestDistance > MATCH_THRESHOLD) {
    return {
      matched: false,
      name: "UNKNOWN",
      age: "--",
      distance: bestDistance,
      confidence: 0
    };
  }

  return {
    matched: true,
    name: winner.name,
    age: winner.age,
    distance: bestDistance,
    confidence: distanceToConfidence(bestDistance)
  };
}

function distanceToConfidence(distance) {
  // Tính hoàn toàn từ Euclidean distance.
  // 0.00 -> 100%, MATCH_THRESHOLD -> 0%.
  const ratio = Math.max(0, Math.min(1, distance / MATCH_THRESHOLD));
  return Math.round((1 - Math.pow(ratio, 1.55)) * 100);
}

function drawDetection(box, match, now) {
  const stageWidth = cameraStage.clientWidth;
  const stageHeight = cameraStage.clientHeight;

  let { x, y, width, height } = box;

  x = Math.max(0, Math.min(stageWidth, x));
  y = Math.max(0, Math.min(stageHeight, y));
  width = Math.max(0, Math.min(width, stageWidth - x));
  height = Math.max(0, Math.min(height, stageHeight - y));

  if (width < 2 || height < 2) return;

  const lineWidth = Math.max(2, Math.min(4, stageWidth / 380));
  const green = "#00ff8a";
  const dimGreen = "rgba(0, 255, 138, 0.36)";
  const white = "#ffffff";

  ctx.save();

  ctx.strokeStyle = green;
  ctx.lineWidth = lineWidth;
  ctx.shadowColor = match.matched ? "rgba(0,255,138,0.85)" : "rgba(0,255,138,0.45)";
  ctx.shadowBlur = match.matched ? 16 : 8;
  ctx.strokeRect(x, y, width, height);

  // Corner accents.
  const corner = Math.max(14, Math.min(width, height) * 0.18);
  ctx.shadowBlur = 0;
  ctx.lineWidth = lineWidth + 1;

  drawCorner(x, y, corner, "tl");
  drawCorner(x + width, y, corner, "tr");
  drawCorner(x, y + height, corner, "bl");
  drawCorner(x + width, y + height, corner, "br");

  // Scan line.
  const scanProgress = ((now / 900) % 1);
  const scanY = y + height * scanProgress;
  const gradient = ctx.createLinearGradient(x, scanY, x + width, scanY);
  gradient.addColorStop(0, "rgba(0,255,138,0)");
  gradient.addColorStop(0.5, match.matched ? "rgba(0,255,138,0.95)" : dimGreen);
  gradient.addColorStop(1, "rgba(0,255,138,0)");
  ctx.strokeStyle = gradient;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, scanY);
  ctx.lineTo(x + width, scanY);
  ctx.stroke();

  const label = match.matched
    ? `${match.name} - ${match.age} - ${match.confidence}%`
    : "UNKNOWN - -- - 0%";

  const fontSize = Math.max(14, Math.min(24, stageWidth / 54));
  ctx.font = `800 ${fontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.textBaseline = "middle";

  const paddingX = 10;
  const labelHeight = fontSize + 14;
  const textWidth = ctx.measureText(label).width;
  const labelWidth = Math.min(stageWidth - 8, textWidth + paddingX * 2);

  let labelX = x;
  if (labelX + labelWidth > stageWidth - 4) {
    labelX = Math.max(4, stageWidth - labelWidth - 4);
  }

  let labelY = y - labelHeight - 7;
  if (labelY < 4) labelY = y + 7;

  ctx.fillStyle = "rgba(3, 9, 8, 0.86)";
  roundedRect(ctx, labelX, labelY, labelWidth, labelHeight, 7);
  ctx.fill();

  ctx.fillStyle = green;
  ctx.fillRect(labelX, labelY, 4, labelHeight);

  ctx.fillStyle = white;
  ctx.shadowColor = match.matched ? "rgba(0,255,138,0.45)" : "transparent";
  ctx.shadowBlur = match.matched ? 7 : 0;
  ctx.fillText(label, labelX + paddingX, labelY + labelHeight / 2);

  if (match.matched) {
    // Nhịp glow nhỏ quanh box khi nhận ra.
    const pulse = (Math.sin(now / 130) + 1) / 2;
    ctx.strokeStyle = `rgba(0,255,138,${0.08 + pulse * 0.18})`;
    ctx.lineWidth = 7 + pulse * 5;
    ctx.strokeRect(x, y, width, height);
  }

  ctx.restore();

  function drawCorner(cx, cy, len, type) {
    ctx.strokeStyle = green;
    ctx.beginPath();

    if (type === "tl") {
      ctx.moveTo(cx, cy + len);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + len, cy);
    } else if (type === "tr") {
      ctx.moveTo(cx - len, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy + len);
    } else if (type === "bl") {
      ctx.moveTo(cx, cy - len);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + len, cy);
    } else {
      ctx.moveTo(cx - len, cy);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx, cy - len);
    }

    ctx.stroke();
  }
}

function roundedRect(context, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);

  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + width, y, x + width, y + height, r);
  context.arcTo(x + width, y + height, x, y + height, r);
  context.arcTo(x, y + height, x, y, r);
  context.arcTo(x, y, x + width, y, r);
  context.closePath();
}

function updateFPS() {
  frameCounter++;
  const now = performance.now();
  const elapsed = now - fpsTimerStart;

  if (elapsed >= 1000) {
    fpsValue.textContent = Math.round((frameCounter * 1000) / elapsed).toString();
    frameCounter = 0;
    fpsTimerStart = now;
  }
}

async function detectionLoop(now) {
  if (!cameraRunning) return;

  detectionRaf = requestAnimationFrame(detectionLoop);

  if (
    detectionBusy ||
    video.readyState < 2 ||
    !video.videoWidth ||
    document.hidden
  ) {
    return;
  }

  detectionBusy = true;

  try {
    const results = await faceapi
      .detectAllFaces(
        video,
        new faceapi.TinyFaceDetectorOptions({
          inputSize: 416,
          scoreThreshold: 0.5
        })
      )
      .withFaceLandmarks()
      .withFaceDescriptors();

    clearOverlay();

    const drawNow = performance.now();

    for (const result of results) {
      const stageBox = videoToStageBox(result.detection.box);
      if (!stageBox) continue;

      const match = bestMatch(result.descriptor);
      drawDetection(stageBox, match, drawNow);
    }

    updateFPS();
  } catch (error) {
    console.error("DEVHAI detection error:", error);
  } finally {
    detectionBusy = false;
  }
}

async function enterFullscreen() {
  try {
    if (!document.fullscreenElement) {
      await cameraStage.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.error("Fullscreen error:", error);
  }
}

async function boot() {
  initSupabase();

  try {
    await loadModels();
    await loadFaceDatabase();

    if (!supabaseClient) {
      console.warn("DEVHAI: camera vẫn chạy nhưng database trống vì Supabase chưa cấu hình.");
    }

    setAIStatus("AI STANDBY", false);
    await startCamera();

    setInterval(() => {
      loadFaceDatabase().catch(console.error);
    }, DATABASE_REFRESH_MS);
  } catch (error) {
    console.error(error);
    showError(
      "KHÔNG TẢI ĐƯỢC AI MODEL",
      "Kiểm tra thư mục /models và đảm bảo bạn đang chạy qua HTTP/HTTPS, không mở bằng file://."
    );
  }
}

toggleCameraBtn.addEventListener("click", toggleCamera);
retryCameraBtn.addEventListener("click", startCamera);
fullscreenBtn.addEventListener("click", enterFullscreen);

window.addEventListener("resize", () => {
  resizeOverlay();
  clearOverlay();
});

document.addEventListener("fullscreenchange", () => {
  resizeOverlay();
});

window.addEventListener("beforeunload", stopCamera);

boot();
