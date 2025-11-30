import tgpu, { type TgpuRoot } from "typegpu";
import * as d from "typegpu/data";
import { showWebGPUError } from "../../shared/webgpu-utils";

// フィルターの種類
type FilterType = "none" | "grayscale" | "sepia" | "invert" | "blur";

// 設定用の構造体
const FilterParams = d.struct({
  filterType: d.u32,
  intensity: d.f32,
  width: d.u32,
  height: d.u32,
});

async function main() {
  const app = document.getElementById("app");
  if (!app) return;

  try {
    // UI作成
    app.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 1rem;">
        <div style="display: grid; grid-template-columns: 1fr 2fr 1fr; gap: 1rem; align-items: end; background: #1a1a1a; padding: 1rem; border-radius: 6px;">
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <span style="font-size: 0.75rem; color: #888;">フィルター</span>
            <select id="filter-select" style="padding: 0.5rem 0.75rem; background: #2a2a2a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; cursor: pointer; height: 36px;">
              <option value="none">なし</option>
              <option value="grayscale">グレースケール</option>
              <option value="sepia">セピア</option>
              <option value="invert">反転</option>
              <option value="blur">ぼかし</option>
            </select>
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <span style="font-size: 0.75rem; color: #888;">強度</span>
              <span id="intensity-value" style="font-size: 0.75rem; color: #888;">100%</span>
            </div>
            <input type="range" id="intensity-slider" min="0" max="100" value="100" style="width: 100%; cursor: pointer; height: 36px;">
          </div>
          <div style="display: flex; flex-direction: column; gap: 0.5rem;">
            <span style="font-size: 0.75rem; color: #888;">画像アップロード</span>
            <label id="upload-area" style="display: flex; align-items: center; justify-content: center; gap: 0.5rem; height: 36px; border: 1px dashed #444; border-radius: 4px; cursor: pointer; transition: border-color 0.2s;">
              <input type="file" id="file-input" accept="image/*" style="display: none;">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#666" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17 8 12 3 7 8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              <span style="font-size: 0.75rem; color: #666;">ファイルを選択</span>
            </label>
          </div>
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;">
          <div>
            <p style="margin: 0 0 0.25rem 0; color: #666; font-size: 0.75rem;">元画像</p>
            <canvas id="source-canvas" width="512" height="384" style="width: 100%; height: auto; border: 1px solid #333; border-radius: 6px;"></canvas>
          </div>
          <div>
            <p style="margin: 0 0 0.25rem 0; color: #666; font-size: 0.75rem;">フィルター適用後</p>
            <canvas id="result-canvas" width="512" height="384" style="width: 100%; height: auto; border: 1px solid #333; border-radius: 6px;"></canvas>
          </div>
        </div>
        <p style="color: #555; font-size: 0.7rem; margin: 0;">GPU (TypeGPU) でリアルタイムに画像フィルターを処理</p>
      </div>
    `;

    const sourceCanvas = document.getElementById(
      "source-canvas"
    ) as HTMLCanvasElement;
    const resultCanvas = document.getElementById(
      "result-canvas"
    ) as HTMLCanvasElement;
    const filterSelect = document.getElementById(
      "filter-select"
    ) as HTMLSelectElement;
    const intensitySlider = document.getElementById(
      "intensity-slider"
    ) as HTMLInputElement;
    const intensityValue = document.getElementById(
      "intensity-value"
    ) as HTMLSpanElement;
    const fileInput = document.getElementById("file-input") as HTMLInputElement;
    const uploadArea = document.getElementById("upload-area") as HTMLLabelElement;

    const width = sourceCanvas.width;
    const height = sourceCanvas.height;

    // サンプル画像を生成（グラデーション + 図形）
    const sourceCtx = sourceCanvas.getContext("2d")!;
    createSampleImage(sourceCtx, width, height);

    // TypeGPU初期化
    const root = await tgpu.init();

    // フィルター処理のセットアップ
    const filterProcessor = await setupFilterProcessor(root, width, height);

    // フィルター適用関数
    async function applyFilter() {
      const filterType = filterSelect.value as FilterType;
      const intensity = parseInt(intensitySlider.value) / 100;

      // 元画像のピクセルデータを取得
      const imageData = sourceCtx.getImageData(0, 0, width, height);

      // GPUでフィルター処理
      const resultData = await filterProcessor.process(
        imageData,
        filterType,
        intensity
      );

      // 結果を描画
      const resultCtx = resultCanvas.getContext("2d")!;
      resultCtx.putImageData(resultData, 0, 0);
    }

    // 画像読み込み関数
    function loadImage(file: File) {
      const img = new Image();
      img.onload = () => {
        // キャンバスにフィットするようにリサイズして描画
        sourceCtx.clearRect(0, 0, width, height);
        const scale = Math.min(width / img.width, height / img.height);
        const drawWidth = img.width * scale;
        const drawHeight = img.height * scale;
        const offsetX = (width - drawWidth) / 2;
        const offsetY = (height - drawHeight) / 2;
        sourceCtx.fillStyle = "#000";
        sourceCtx.fillRect(0, 0, width, height);
        sourceCtx.drawImage(img, offsetX, offsetY, drawWidth, drawHeight);
        applyFilter();
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    }

    // イベントリスナー
    filterSelect.addEventListener("change", applyFilter);
    intensitySlider.addEventListener("input", () => {
      intensityValue.textContent = `${intensitySlider.value}%`;
      applyFilter();
    });

    // ファイル選択
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      if (file) loadImage(file);
    });

    // ドラッグ&ドロップ対応
    uploadArea.addEventListener("dragover", (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = "#3b82f6";
    });
    uploadArea.addEventListener("dragleave", () => {
      uploadArea.style.borderColor = "#444";
    });
    uploadArea.addEventListener("drop", (e) => {
      e.preventDefault();
      uploadArea.style.borderColor = "#444";
      const file = e.dataTransfer?.files[0];
      if (file && file.type.startsWith("image/")) loadImage(file);
    });

    // 初期描画
    await applyFilter();
  } catch (error) {
    showWebGPUError(app, error as Error);
  }
}

// サンプル画像を生成
function createSampleImage(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number
) {
  // グラデーション背景
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#ff6b6b");
  gradient.addColorStop(0.25, "#feca57");
  gradient.addColorStop(0.5, "#48dbfb");
  gradient.addColorStop(0.75, "#ff9ff3");
  gradient.addColorStop(1, "#54a0ff");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  // 円を描画
  ctx.fillStyle = "rgba(255, 255, 255, 0.8)";
  ctx.beginPath();
  ctx.arc(100, 100, 60, 0, Math.PI * 2);
  ctx.fill();

  // 四角形を描画
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(250, 80, 100, 100);

  // 三角形を描画
  ctx.fillStyle = "rgba(255, 255, 255, 0.6)";
  ctx.beginPath();
  ctx.moveTo(200, 250);
  ctx.lineTo(280, 280);
  ctx.lineTo(160, 280);
  ctx.closePath();
  ctx.fill();

  // テキスト
  ctx.fillStyle = "#fff";
  ctx.font = "bold 24px sans-serif";
  ctx.fillText("TypeGPU", 260, 240);
}

// フィルター処理のセットアップ
async function setupFilterProcessor(
  root: TgpuRoot,
  width: number,
  height: number
) {
  const device = root.device;
  const pixelCount = width * height;

  // バインドグループレイアウト
  const layout = tgpu.bindGroupLayout({
    params: { uniform: FilterParams },
    inputPixels: { storage: d.arrayOf(d.u32, pixelCount), access: "readonly" },
    outputPixels: { storage: d.arrayOf(d.u32, pixelCount), access: "mutable" },
  });

  // シェーダーコード
  const shaderCode = /* wgsl */ `
@group(0) @binding(0) var<uniform> params: FilterParams;
@group(0) @binding(1) var<storage, read> inputPixels: array<u32>;
@group(0) @binding(2) var<storage, read_write> outputPixels: array<u32>;

// RGBA を u32 から展開
fn unpack_rgba(packed: u32) -> vec4f {
  return vec4f(
    f32(packed & 0xffu) / 255.0,
    f32((packed >> 8u) & 0xffu) / 255.0,
    f32((packed >> 16u) & 0xffu) / 255.0,
    f32((packed >> 24u) & 0xffu) / 255.0
  );
}

// vec4f を u32 にパック
fn pack_rgba(color: vec4f) -> u32 {
  let r = u32(clamp(color.r, 0.0, 1.0) * 255.0);
  let g = u32(clamp(color.g, 0.0, 1.0) * 255.0);
  let b = u32(clamp(color.b, 0.0, 1.0) * 255.0);
  let a = u32(clamp(color.a, 0.0, 1.0) * 255.0);
  return r | (g << 8u) | (b << 16u) | (a << 24u);
}

// グレースケール
fn grayscale(color: vec4f, intensity: f32) -> vec4f {
  let gray = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
  let grayColor = vec3f(gray);
  return vec4f(mix(color.rgb, grayColor, intensity), color.a);
}

// セピア
fn sepia(color: vec4f, intensity: f32) -> vec4f {
  let sepiaColor = vec3f(
    dot(color.rgb, vec3f(0.393, 0.769, 0.189)),
    dot(color.rgb, vec3f(0.349, 0.686, 0.168)),
    dot(color.rgb, vec3f(0.272, 0.534, 0.131))
  );
  return vec4f(mix(color.rgb, sepiaColor, intensity), color.a);
}

// 反転
fn invert(color: vec4f, intensity: f32) -> vec4f {
  let invertedColor = vec3f(1.0) - color.rgb;
  return vec4f(mix(color.rgb, invertedColor, intensity), color.a);
}

// ぼかし（単純な3x3ボックスブラー）
fn blur(index: u32, intensity: f32) -> vec4f {
  let x = index % params.width;
  let y = index / params.width;

  var sum = vec4f(0.0);
  var count = 0.0;

  let radius = i32(intensity * 3.0) + 1;

  for (var dy = -radius; dy <= radius; dy++) {
    for (var dx = -radius; dx <= radius; dx++) {
      let nx = i32(x) + dx;
      let ny = i32(y) + dy;

      if (nx >= 0 && nx < i32(params.width) && ny >= 0 && ny < i32(params.height)) {
        let ni = u32(ny) * params.width + u32(nx);
        sum += unpack_rgba(inputPixels[ni]);
        count += 1.0;
      }
    }
  }

  return sum / count;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  if (index >= params.width * params.height) {
    return;
  }

  let inputColor = unpack_rgba(inputPixels[index]);
  var outputColor: vec4f;

  switch params.filterType {
    case 0u: { // none
      outputColor = inputColor;
    }
    case 1u: { // grayscale
      outputColor = grayscale(inputColor, params.intensity);
    }
    case 2u: { // sepia
      outputColor = sepia(inputColor, params.intensity);
    }
    case 3u: { // invert
      outputColor = invert(inputColor, params.intensity);
    }
    case 4u: { // blur
      outputColor = blur(index, params.intensity);
    }
    default: {
      outputColor = inputColor;
    }
  }

  outputPixels[index] = pack_rgba(outputColor);
}
`;

  // バッファ作成
  const paramsBuffer = root.createBuffer(FilterParams).$usage("uniform");
  const inputBuffer = root
    .createBuffer(d.arrayOf(d.u32, pixelCount))
    .$usage("storage");
  const outputBuffer = root
    .createBuffer(d.arrayOf(d.u32, pixelCount))
    .$usage("storage");

  // パイプライン作成
  const pipeline = device.createComputePipeline({
    layout: device.createPipelineLayout({
      bindGroupLayouts: [root.unwrap(layout)],
    }),
    compute: {
      module: device.createShaderModule({
        code: tgpu.resolve({
          template: shaderCode,
          externals: { FilterParams },
        }),
      }),
    },
  });

  // バインドグループ作成
  const bindGroup = root.createBindGroup(layout, {
    params: paramsBuffer,
    inputPixels: inputBuffer,
    outputPixels: outputBuffer,
  });

  // フィルタータイプをu32に変換
  const filterTypeMap: Record<FilterType, number> = {
    none: 0,
    grayscale: 1,
    sepia: 2,
    invert: 3,
    blur: 4,
  };

  return {
    async process(
      imageData: ImageData,
      filterType: FilterType,
      intensity: number
    ): Promise<ImageData> {
      // パラメータを書き込み
      paramsBuffer.write({
        filterType: filterTypeMap[filterType],
        intensity,
        width,
        height,
      });

      // 入力ピクセルをu32配列に変換
      const inputArray = new Uint32Array(pixelCount);
      for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        inputArray[i] =
          imageData.data[offset] |
          (imageData.data[offset + 1] << 8) |
          (imageData.data[offset + 2] << 16) |
          (imageData.data[offset + 3] << 24);
      }
      inputBuffer.write(Array.from(inputArray));

      // コンピュートシェーダー実行
      const encoder = device.createCommandEncoder();
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeline);
      pass.setBindGroup(0, root.unwrap(bindGroup));
      pass.dispatchWorkgroups(Math.ceil(pixelCount / 64));
      pass.end();
      device.queue.submit([encoder.finish()]);

      // 結果を読み取り
      const result = await outputBuffer.read();

      // ImageDataに変換
      const resultImageData = new ImageData(width, height);
      for (let i = 0; i < pixelCount; i++) {
        const offset = i * 4;
        const packed = result[i];
        resultImageData.data[offset] = packed & 0xff;
        resultImageData.data[offset + 1] = (packed >> 8) & 0xff;
        resultImageData.data[offset + 2] = (packed >> 16) & 0xff;
        resultImageData.data[offset + 3] = (packed >> 24) & 0xff;
      }

      return resultImageData;
    },
  };
}

main();
