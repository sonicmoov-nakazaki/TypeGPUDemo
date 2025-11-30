import tgpu from "typegpu";
import * as d from "typegpu/data";
import { showWebGPUError } from "../../shared/webgpu-utils";
import { createCamera } from "./camera";
import {
  PLANETS,
  SUN_RADIUS,
  SUN_COLOR,
  SATURN_RING,
  BACKGROUND_STARS,
} from "./solar-system";

// シェーダーで使う構造体
const CameraUniforms = d.struct({
  viewProjection: d.mat4x4f,
  cameraPosition: d.vec3f,
  _pad: d.f32,
});

const TimeUniforms = d.struct({
  time: d.f32,
  deltaTime: d.f32,
});

// 惑星インスタンスデータ
const PlanetInstance = d.struct({
  position: d.vec3f,
  radius: d.f32,
  color: d.vec3f,
  _pad: d.f32,
});

// パーティクルデータ
const Particle = d.struct({
  position: d.vec3f,
  size: d.f32,
  color: d.vec4f,
  orbitCenter: d.vec3f,
  orbitRadius: d.f32,
  orbitSpeed: d.f32,
  orbitAngle: d.f32,
  orbitTilt: d.f32,
  _pad: d.f32,
});

async function main() {
  const app = document.getElementById("app");
  if (!app) return;

  try {
    // UI作成
    app.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 0.5rem;">
        <div style="display: flex; gap: 1rem; align-items: center; background: #1a1a1a; padding: 0.75rem 1rem; border-radius: 6px;">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span style="font-size: 0.75rem; color: #888;">時間速度</span>
            <input type="range" id="speed-slider" min="0" max="200" value="50" style="width: 120px; cursor: pointer;">
            <span id="speed-value" style="font-size: 0.75rem; color: #888; min-width: 40px;">1.0x</span>
          </div>
          <button id="reset-btn" style="padding: 0.4rem 0.8rem; background: #2a2a2a; color: #e0e0e0; border: 1px solid #444; border-radius: 4px; cursor: pointer; font-size: 0.75rem;">
            リセット
          </button>
          <span style="flex: 1;"></span>
          <span style="font-size: 0.7rem; color: #555;">左ドラッグ: 回転 | 右ドラッグ/Shift+左: パン | ホイール: ズーム | ダブルクリック: リセット</span>
        </div>
        <canvas id="solar-canvas" style="width: 100%; height: 70vh; border-radius: 6px; background: #000;"></canvas>
      </div>
    `;

    const canvas = document.getElementById("solar-canvas") as HTMLCanvasElement;
    const speedSlider = document.getElementById("speed-slider") as HTMLInputElement;
    const speedValue = document.getElementById("speed-value") as HTMLSpanElement;
    const resetBtn = document.getElementById("reset-btn") as HTMLButtonElement;

    // キャンバスサイズ設定
    const resize = () => {
      canvas.width = canvas.clientWidth * devicePixelRatio;
      canvas.height = canvas.clientHeight * devicePixelRatio;
    };
    resize();
    window.addEventListener("resize", resize);

    // カメラ初期化
    const camera = createCamera(canvas);

    // TypeGPU初期化
    const root = await tgpu.init();
    const device = root.device;

    // WebGPUコンテキスト
    const context = canvas.getContext("webgpu")!;
    if (!context) throw new Error("WebGPU context not available");

    const format = navigator.gpu.getPreferredCanvasFormat();
    context.configure({ device, format, alphaMode: "premultiplied" });

    // 深度バッファ
    let depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });

    // リサイズ時に深度バッファも更新
    const originalResize = resize;
    const resizeWithDepth = () => {
      originalResize();
      depthTexture.destroy();
      depthTexture = device.createTexture({
        size: [canvas.width, canvas.height],
        format: "depth24plus",
        usage: GPUTextureUsage.RENDER_ATTACHMENT,
      });
    };
    window.removeEventListener("resize", resize);
    window.addEventListener("resize", resizeWithDepth);

    // ===============================
    // バッファ作成
    // ===============================
    const cameraBuffer = root.createBuffer(CameraUniforms).$usage("uniform");
    const timeBuffer = root.createBuffer(TimeUniforms).$usage("uniform");

    // 惑星データ（太陽 + 8惑星）
    const planetCount = 1 + PLANETS.length;
    const planetBuffer = root
      .createBuffer(d.arrayOf(PlanetInstance, planetCount))
      .$usage("storage");

    // パーティクル（土星の輪 + 衛星 + 背景星）
    // 衛星の数を事前に計算
    const satelliteCount = PLANETS.reduce((sum, p) => sum + (p.satellites?.length ?? 0), 0);
    const totalParticles =
      SATURN_RING.particleCount + satelliteCount + BACKGROUND_STARS.count;
    const particleBuffer = root
      .createBuffer(d.arrayOf(Particle, totalParticles))
      .$usage("storage");

    // パーティクルパラメータ（土星の輪追跡用）
    const ParticleParams = d.struct({
      saturnRingStart: d.u32,
      saturnRingEnd: d.u32,
      saturnPosition: d.vec3f,
      _pad: d.f32,
    });
    const particleParamsBuffer = root.createBuffer(ParticleParams).$usage("uniform");

    // 土星の輪パーティクルの範囲
    const saturnRingStart = 0;
    const saturnRingEnd = SATURN_RING.particleCount;

    // 軌道線データ（WGSLのvec4fは16バイトアライン）
    const OrbitData = d.struct({
      radius: d.f32,
      _pad1: d.f32,  // vec4fのアラインメント用パディング
      _pad2: d.f32,
      _pad3: d.f32,
      color: d.vec4f,
    });
    const orbitLineBuffer = root
      .createBuffer(d.arrayOf(OrbitData, PLANETS.length))
      .$usage("storage");

    // ===============================
    // シェーダー
    // ===============================

    // 惑星描画用シェーダー（球をビルボードで近似）
    const planetShaderCode = /* wgsl */ `
struct CameraUniforms {
  viewProjection: mat4x4f,
  cameraPosition: vec3f,
}

struct PlanetInstance {
  position: vec3f,
  radius: f32,
  color: vec3f,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> planets: array<PlanetInstance>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec3f,
  @location(1) uv: vec2f,
  @location(2) planetIndex: f32,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let planet = planets[instanceIndex];

  // 四角形の頂点（ビルボード）
  var quadPos = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, 1.0),
  );

  let pos2d = quadPos[vertexIndex];

  // カメラに向くビルボード
  let toCamera = normalize(camera.cameraPosition - planet.position);
  // カメラが真上/真下の場合に備えて、別のup vectorを使う
  var worldUp = vec3f(0.0, 1.0, 0.0);
  if (abs(dot(toCamera, worldUp)) > 0.99) {
    worldUp = vec3f(0.0, 0.0, 1.0);
  }
  let right = normalize(cross(worldUp, toCamera));
  let up = cross(toCamera, right);

  let worldPos = planet.position + (right * pos2d.x + up * pos2d.y) * planet.radius;

  var output: VertexOutput;
  output.position = camera.viewProjection * vec4f(worldPos, 1.0);
  output.color = planet.color;
  output.uv = pos2d * 0.5 + 0.5;
  output.planetIndex = f32(instanceIndex);
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  // 円形にする
  let dist = length(input.uv - vec2f(0.5));
  if (dist > 0.5) {
    discard;
  }

  // 簡易的なシェーディング
  let normal = vec3f((input.uv - 0.5) * 2.0, sqrt(max(0.0, 1.0 - dist * dist * 4.0)));
  let lightDir = normalize(vec3f(0.0, 0.0, 0.0) - vec3f(1.0, 1.0, 1.0));
  let diffuse = max(dot(normal, -lightDir), 0.3);

  // 太陽（index 0）は発光
  if (input.planetIndex < 0.5) {
    return vec4f(input.color * 1.5, 1.0);
  }

  return vec4f(input.color * diffuse, 1.0);
}
`;

    // パーティクル描画用シェーダー
    const particleShaderCode = /* wgsl */ `
struct CameraUniforms {
  viewProjection: mat4x4f,
  cameraPosition: vec3f,
}

struct Particle {
  position: vec3f,
  size: f32,
  color: vec4f,
  orbitCenter: vec3f,
  orbitRadius: f32,
  orbitSpeed: f32,
  orbitAngle: f32,
  orbitTilt: f32,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) uv: vec2f,
}

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) instanceIndex: u32) -> VertexOutput {
  let particle = particles[instanceIndex];

  var quadPos = array<vec2f, 6>(
    vec2f(-1.0, -1.0),
    vec2f(1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0),
    vec2f(1.0, 1.0),
    vec2f(-1.0, 1.0),
  );

  let pos2d = quadPos[vertexIndex];

  let toCamera = normalize(camera.cameraPosition - particle.position);
  var worldUp = vec3f(0.0, 1.0, 0.0);
  if (abs(dot(toCamera, worldUp)) > 0.99) {
    worldUp = vec3f(0.0, 0.0, 1.0);
  }
  let right = normalize(cross(worldUp, toCamera));
  let up = cross(toCamera, right);

  let worldPos = particle.position + (right * pos2d.x + up * pos2d.y) * particle.size;

  var output: VertexOutput;
  output.position = camera.viewProjection * vec4f(worldPos, 1.0);
  output.color = particle.color;
  output.uv = pos2d * 0.5 + 0.5;
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  let dist = length(input.uv - vec2f(0.5));
  if (dist > 0.5) {
    discard;
  }

  // 中心が明るく、端がフェードアウト
  let alpha = input.color.a * (1.0 - dist * 2.0);
  return vec4f(input.color.rgb, alpha);
}
`;

    // 軌道線描画用シェーダー（太い線を四角形で描画）
    const ORBIT_SEGMENTS = 128;  // 軌道の分割数
    const ORBIT_LINE_WIDTH = 2.0;  // 軌道線の太さ
    const orbitShaderCode = /* wgsl */ `
struct CameraUniforms {
  viewProjection: mat4x4f,
  cameraPosition: vec3f,
}

struct OrbitData {
  radius: f32,
  _pad1: f32,
  _pad2: f32,
  _pad3: f32,
  color: vec4f,
}

@group(0) @binding(0) var<uniform> camera: CameraUniforms;
@group(0) @binding(1) var<storage, read> orbits: array<OrbitData>;

struct VertexOutput {
  @builtin(position) position: vec4f,
  @location(0) color: vec4f,
  @location(1) uv: vec2f,
}

const PI: f32 = 3.14159265359;
const SEGMENTS: u32 = ${ORBIT_SEGMENTS}u;
const LINE_WIDTH: f32 = ${ORBIT_LINE_WIDTH};

@vertex
fn vs_main(@builtin(vertex_index) vertexIndex: u32, @builtin(instance_index) orbitIndex: u32) -> VertexOutput {
  let orbit = orbits[orbitIndex];

  // 各セグメントで6頂点（2つの三角形で四角形を構成）
  let segmentIndex = vertexIndex / 6u;
  let vertInQuad = vertexIndex % 6u;

  // 四角形の頂点インデックス: 0,1,2, 0,2,3 -> 0,1,2,3の4頂点
  var quadVertex: u32;
  if (vertInQuad == 0u || vertInQuad == 3u) {
    quadVertex = 0u;
  } else if (vertInQuad == 1u) {
    quadVertex = 1u;
  } else if (vertInQuad == 2u || vertInQuad == 4u) {
    quadVertex = 2u;
  } else {
    quadVertex = 3u;
  }

  // セグメントの始点と終点の角度
  let angle0 = (f32(segmentIndex) / f32(SEGMENTS)) * 2.0 * PI;
  let angle1 = (f32(segmentIndex + 1u) / f32(SEGMENTS)) * 2.0 * PI;

  // 内側/外側の判定
  let isOuter = quadVertex == 1u || quadVertex == 2u;
  let isEnd = quadVertex == 2u || quadVertex == 3u;

  let angle = select(angle0, angle1, isEnd);
  let radiusOffset = select(-LINE_WIDTH * 0.5, LINE_WIDTH * 0.5, isOuter);
  let actualRadius = orbit.radius + radiusOffset;

  let x = cos(angle) * actualRadius;
  let z = sin(angle) * actualRadius;
  let worldPos = vec3f(x, 0.0, z);

  var output: VertexOutput;
  output.position = camera.viewProjection * vec4f(worldPos, 1.0);
  output.color = orbit.color;
  output.uv = vec2f(select(0.0, 1.0, isOuter), select(0.0, 1.0, isEnd));
  return output;
}

@fragment
fn fs_main(input: VertexOutput) -> @location(0) vec4f {
  // 端をフェードアウトさせてスムーズに
  let edgeFade = 1.0 - abs(input.uv.x * 2.0 - 1.0) * 0.3;
  return vec4f(input.color.rgb, input.color.a * edgeFade);
}
`;

    // パーティクル更新用Compute Shader
    const particleComputeCode = /* wgsl */ `
struct TimeUniforms {
  time: f32,
  deltaTime: f32,
}

struct ParticleParams {
  saturnRingStart: u32,
  saturnRingEnd: u32,
  saturnPosition: vec3f,
}

struct Particle {
  position: vec3f,
  size: f32,
  color: vec4f,
  orbitCenter: vec3f,
  orbitRadius: f32,
  orbitSpeed: f32,
  orbitAngle: f32,
  orbitTilt: f32,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> time: TimeUniforms;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<uniform> params: ParticleParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  if (index >= arrayLength(&particles)) {
    return;
  }

  var p = particles[index];

  // 軌道がある場合（orbitRadius > 0）のみ更新
  if (p.orbitRadius > 0.0) {
    p.orbitAngle += p.orbitSpeed * time.deltaTime;

    // 土星の輪パーティクルは土星の位置を追跡
    if (index >= params.saturnRingStart && index < params.saturnRingEnd) {
      p.orbitCenter = params.saturnPosition;
    }

    // 土星の輪は特別な傾斜処理
    if (index >= params.saturnRingStart && index < params.saturnRingEnd) {
      // 土星の輪の傾斜角（約27度）
      let RING_TILT: f32 = 0.47;
      let cosT = cos(RING_TILT);
      let sinT = sin(RING_TILT);

      let localX = cos(p.orbitAngle) * p.orbitRadius;
      let localY = p.orbitTilt;  // 厚み（初期化時に設定）
      let localZ = sin(p.orbitAngle) * p.orbitRadius;

      // 傾斜を適用
      let tiltedY = localY * cosT - localZ * sinT;
      let tiltedZ = localY * sinT + localZ * cosT;

      p.position = p.orbitCenter + vec3f(localX, tiltedY, tiltedZ);
    } else {
      // 通常のパーティクル（小惑星帯など）
      let x = cos(p.orbitAngle) * p.orbitRadius;
      let z = sin(p.orbitAngle) * p.orbitRadius;
      let y = sin(p.orbitAngle) * p.orbitTilt;

      p.position = p.orbitCenter + vec3f(x, y, z);
    }
  }

  particles[index] = p;
}
`;

    // 惑星更新用Compute Shader
    const planetComputeCode = /* wgsl */ `
struct TimeUniforms {
  time: f32,
  deltaTime: f32,
}

struct PlanetInstance {
  position: vec3f,
  radius: f32,
  color: vec3f,
  _pad: f32,
}

struct PlanetOrbit {
  orbitRadius: f32,
  orbitSpeed: f32,
  angle: f32,
  _pad: f32,
}

@group(0) @binding(0) var<uniform> time: TimeUniforms;
@group(0) @binding(1) var<storage, read_write> planets: array<PlanetInstance>;
@group(0) @binding(2) var<storage, read_write> orbits: array<PlanetOrbit>;

@compute @workgroup_size(16)
fn main(@builtin(global_invocation_id) global_id: vec3u) {
  let index = global_id.x;
  if (index >= arrayLength(&planets)) {
    return;
  }

  // index 0 は太陽（動かない）
  if (index == 0u) {
    return;
  }

  var orbit = orbits[index];
  orbit.angle += orbit.orbitSpeed * time.deltaTime;

  var planet = planets[index];
  planet.position.x = cos(orbit.angle) * orbit.orbitRadius;
  planet.position.z = sin(orbit.angle) * orbit.orbitRadius;

  planets[index] = planet;
  orbits[index] = orbit;
}
`;

    // ===============================
    // パイプライン作成
    // ===============================

    // 惑星描画パイプライン
    const planetBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });

    const planetPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [planetBindGroupLayout] }),
      vertex: {
        module: device.createShaderModule({ code: planetShaderCode }),
        entryPoint: "vs_main",
      },
      fragment: {
        module: device.createShaderModule({ code: planetShaderCode }),
        entryPoint: "fs_main",
        targets: [{ format }],
      },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    // 軌道線描画パイプライン
    const orbitBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });

    const orbitPipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [orbitBindGroupLayout] }),
      vertex: {
        module: device.createShaderModule({ code: orbitShaderCode }),
        entryPoint: "vs_main",
      },
      fragment: {
        module: device.createShaderModule({ code: orbitShaderCode }),
        entryPoint: "fs_main",
        targets: [{
          format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less",
      },
    });

    // パーティクル描画パイプライン
    const particleBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.VERTEX, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.VERTEX, buffer: { type: "read-only-storage" } },
      ],
    });

    const particlePipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [particleBindGroupLayout] }),
      vertex: {
        module: device.createShaderModule({ code: particleShaderCode }),
        entryPoint: "vs_main",
      },
      fragment: {
        module: device.createShaderModule({ code: particleShaderCode }),
        entryPoint: "fs_main",
        targets: [{
          format,
          blend: {
            color: { srcFactor: "src-alpha", dstFactor: "one-minus-src-alpha", operation: "add" },
            alpha: { srcFactor: "one", dstFactor: "one-minus-src-alpha", operation: "add" },
          },
        }],
      },
      primitive: { topology: "triangle-list" },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "less",
      },
    });

    // パーティクル更新Computeパイプライン
    const particleComputeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ],
    });

    const particleComputePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [particleComputeBindGroupLayout] }),
      compute: {
        module: device.createShaderModule({ code: particleComputeCode }),
        entryPoint: "main",
      },
    });

    // 惑星軌道データ
    const PlanetOrbit = d.struct({
      orbitRadius: d.f32,
      orbitSpeed: d.f32,
      angle: d.f32,
      _pad: d.f32,
    });

    const orbitBuffer = root
      .createBuffer(d.arrayOf(PlanetOrbit, planetCount))
      .$usage("storage");

    // 惑星更新Computeパイプライン
    const planetComputeBindGroupLayout = device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
      ],
    });

    const planetComputePipeline = device.createComputePipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [planetComputeBindGroupLayout] }),
      compute: {
        module: device.createShaderModule({ code: planetComputeCode }),
        entryPoint: "main",
      },
    });

    // ===============================
    // バインドグループ作成
    // ===============================

    const planetBindGroup = device.createBindGroup({
      layout: planetBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: root.unwrap(cameraBuffer) } },
        { binding: 1, resource: { buffer: root.unwrap(planetBuffer) } },
      ],
    });

    const particleBindGroup = device.createBindGroup({
      layout: particleBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: root.unwrap(cameraBuffer) } },
        { binding: 1, resource: { buffer: root.unwrap(particleBuffer) } },
      ],
    });

    const particleComputeBindGroup = device.createBindGroup({
      layout: particleComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: root.unwrap(timeBuffer) } },
        { binding: 1, resource: { buffer: root.unwrap(particleBuffer) } },
        { binding: 2, resource: { buffer: root.unwrap(particleParamsBuffer) } },
      ],
    });

    const planetComputeBindGroup = device.createBindGroup({
      layout: planetComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: root.unwrap(timeBuffer) } },
        { binding: 1, resource: { buffer: root.unwrap(planetBuffer) } },
        { binding: 2, resource: { buffer: root.unwrap(orbitBuffer) } },
      ],
    });

    const orbitLineBindGroup = device.createBindGroup({
      layout: orbitBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: root.unwrap(cameraBuffer) } },
        { binding: 1, resource: { buffer: root.unwrap(orbitLineBuffer) } },
      ],
    });

    // ===============================
    // 初期データ設定
    // ===============================

    // 惑星初期データ
    const initialPlanets = [
      // 太陽
      { position: d.vec3f(0, 0, 0), radius: SUN_RADIUS, color: d.vec3f(...SUN_COLOR), _pad: 0 },
      // 8惑星
      ...PLANETS.map((p) => ({
        position: d.vec3f(p.orbitRadius, 0, 0),
        radius: p.radius,
        color: d.vec3f(...p.color),
        _pad: 0,
      })),
    ];
    planetBuffer.write(initialPlanets);

    // 軌道初期データ
    const initialOrbits = [
      { orbitRadius: 0, orbitSpeed: 0, angle: 0, _pad: 0 },  // 太陽
      ...PLANETS.map((p) => ({
        orbitRadius: p.orbitRadius,
        orbitSpeed: p.orbitSpeed,
        angle: Math.random() * Math.PI * 2,
        _pad: 0,
      })),
    ];
    orbitBuffer.write(initialOrbits);

    // 軌道線初期データ（惑星の軌道を表示）
    const initialOrbitLines = PLANETS.map((p) => ({
      radius: p.orbitRadius,
      _pad1: 0,
      _pad2: 0,
      _pad3: 0,
      color: d.vec4f(p.color[0] * 0.4, p.color[1] * 0.4, p.color[2] * 0.4, 0.5),  // 薄い色
    }));
    orbitLineBuffer.write(initialOrbitLines);

    // パーティクル初期データ
    const particles: Array<{
      position: ReturnType<typeof d.vec3f>;
      size: number;
      color: ReturnType<typeof d.vec4f>;
      orbitCenter: ReturnType<typeof d.vec3f>;
      orbitRadius: number;
      orbitSpeed: number;
      orbitAngle: number;
      orbitTilt: number;
      _pad: number;
    }> = [];

    // 土星の輪パーティクル（傾斜約27度 = 0.47ラジアン）
    const saturnData = PLANETS.find((p) => p.name === "Saturn")!;
    const RING_TILT_ANGLE = 0.47;  // 土星の輪の傾斜角（ラジアン）
    const cosRingTilt = Math.cos(RING_TILT_ANGLE);
    const sinRingTilt = Math.sin(RING_TILT_ANGLE);

    for (let i = 0; i < SATURN_RING.particleCount; i++) {
      const angle = Math.random() * Math.PI * 2;
      // 内側ほど密度を高く（リング構造）
      const t = Math.random();
      const radius = SATURN_RING.innerRadius + t * t * (SATURN_RING.outerRadius - SATURN_RING.innerRadius);
      const thickness = (Math.random() - 0.5) * 1.5;  // 輪の厚み

      // 傾斜を適用（X軸周りに回転）
      const localX = Math.cos(angle) * radius;
      const localY = thickness;
      const localZ = Math.sin(angle) * radius;

      // 傾斜後の座標
      const tiltedY = localY * cosRingTilt - localZ * sinRingTilt;
      const tiltedZ = localY * sinRingTilt + localZ * cosRingTilt;

      // 内側と外側で色と透明度を変える
      const normalizedRadius = (radius - SATURN_RING.innerRadius) / (SATURN_RING.outerRadius - SATURN_RING.innerRadius);
      const brightness = 0.7 + normalizedRadius * 0.3;
      const alpha = 0.4 + (1 - normalizedRadius) * 0.4;

      particles.push({
        position: d.vec3f(
          saturnData.orbitRadius + localX,
          tiltedY,
          tiltedZ,
        ),
        size: 0.2 + Math.random() * 0.4 + (1 - normalizedRadius) * 0.3,
        color: d.vec4f(
          SATURN_RING.color[0] * brightness + (Math.random() - 0.5) * 0.15,
          SATURN_RING.color[1] * brightness + (Math.random() - 0.5) * 0.15,
          SATURN_RING.color[2] * brightness + (Math.random() - 0.5) * 0.1,
          alpha,
        ),
        orbitCenter: d.vec3f(saturnData.orbitRadius, 0, 0),
        orbitRadius: radius,
        orbitSpeed: 0.3 + Math.random() * 0.4,
        orbitAngle: angle,
        orbitTilt: thickness,  // 傾斜情報として厚みを保存
        _pad: 0,
      });
    }

    // 衛星パーティクル（惑星に追従する衛星）
    // 衛星は特殊な処理が必要なので、別途管理
    interface SatelliteInfo {
      planetIndex: number;  // 親惑星のインデックス（PLANETS配列での位置）
      particleIndex: number;  // パーティクル配列での位置
      orbitRadius: number;
      orbitSpeed: number;
      angle: number;
    }
    const satelliteInfos: SatelliteInfo[] = [];

    PLANETS.forEach((planet, planetIdx) => {
      if (planet.satellites) {
        for (const sat of planet.satellites) {
          const angle = Math.random() * Math.PI * 2;
          satelliteInfos.push({
            planetIndex: planetIdx,
            particleIndex: particles.length,
            orbitRadius: sat.orbitRadius,
            orbitSpeed: sat.orbitSpeed,
            angle,
          });

          particles.push({
            position: d.vec3f(
              planet.orbitRadius + sat.orbitRadius,  // 初期位置（後で更新）
              0,
              0,
            ),
            size: sat.radius,
            color: d.vec4f(sat.color[0], sat.color[1], sat.color[2], 1.0),
            orbitCenter: d.vec3f(planet.orbitRadius, 0, 0),  // 初期（後で更新）
            orbitRadius: sat.orbitRadius,
            orbitSpeed: sat.orbitSpeed,
            orbitAngle: angle,
            orbitTilt: 0,
            _pad: 0,
          });
        }
      }
    });

    // 背景の星（軌道なし、固定位置）
    for (let i = 0; i < BACKGROUND_STARS.count; i++) {
      // 球面上にランダム配置
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const dist =
        BACKGROUND_STARS.minDistance +
        Math.random() * (BACKGROUND_STARS.maxDistance - BACKGROUND_STARS.minDistance);

      const x = dist * Math.sin(phi) * Math.cos(theta);
      const y = dist * Math.sin(phi) * Math.sin(theta);
      const z = dist * Math.cos(phi);

      const brightness = 0.5 + Math.random() * 0.5;

      particles.push({
        position: d.vec3f(x, y, z),
        size: 1 + Math.random() * 2,
        color: d.vec4f(brightness, brightness, brightness * 0.9, 1.0),
        orbitCenter: d.vec3f(0, 0, 0),
        orbitRadius: 0,  // 軌道なし
        orbitSpeed: 0,
        orbitAngle: 0,
        orbitTilt: 0,
        _pad: 0,
      });
    }

    particleBuffer.write(particles);

    // ===============================
    // レンダーループ
    // ===============================

    let lastTime = performance.now();
    let timeSpeed = 1.0;

    // 惑星の軌道追跡（CPU側）- 土星の輪と衛星の追従用
    const planetOrbits = PLANETS.map((p, i) => ({
      radius: p.orbitRadius,
      speed: p.orbitSpeed,
      angle: initialOrbits[i + 1].angle,  // +1 は太陽分
    }));
    const saturnIndex = PLANETS.findIndex((p) => p.name === "Saturn");

    function render() {
      const now = performance.now();
      const deltaTime = ((now - lastTime) / 1000) * timeSpeed;
      lastTime = now;

      // 全惑星の軌道を更新（CPU側で追跡）
      const planetPositions: [number, number, number][] = [];
      for (let i = 0; i < planetOrbits.length; i++) {
        planetOrbits[i].angle += planetOrbits[i].speed * deltaTime;
        const x = Math.cos(planetOrbits[i].angle) * planetOrbits[i].radius;
        const z = Math.sin(planetOrbits[i].angle) * planetOrbits[i].radius;
        planetPositions.push([x, 0, z]);
      }

      // 土星の位置を取得
      const saturnPos = planetPositions[saturnIndex];

      // パーティクルパラメータを更新（土星の位置）
      particleParamsBuffer.write({
        saturnRingStart,
        saturnRingEnd,
        saturnPosition: d.vec3f(saturnPos[0], saturnPos[1], saturnPos[2]),
        _pad: 0,
      });

      // 衛星の位置を更新
      for (const sat of satelliteInfos) {
        sat.angle += sat.orbitSpeed * deltaTime;
        const parentPos = planetPositions[sat.planetIndex];
        const satX = parentPos[0] + Math.cos(sat.angle) * sat.orbitRadius;
        const satZ = parentPos[2] + Math.sin(sat.angle) * sat.orbitRadius;

        // パーティクルバッファを直接更新（CPU書き込み）
        particles[sat.particleIndex].position = d.vec3f(satX, 0, satZ);
        particles[sat.particleIndex].orbitCenter = d.vec3f(parentPos[0], parentPos[1], parentPos[2]);
      }
      // 衛星の更新をGPUに書き込み
      if (satelliteInfos.length > 0) {
        particleBuffer.write(particles);
      }

      // カメラ更新
      const matrices = camera.getMatrices();
      const vp = matrices.viewProjection;
      cameraBuffer.write({
        viewProjection: d.mat4x4f(
          d.vec4f(vp[0], vp[1], vp[2], vp[3]),
          d.vec4f(vp[4], vp[5], vp[6], vp[7]),
          d.vec4f(vp[8], vp[9], vp[10], vp[11]),
          d.vec4f(vp[12], vp[13], vp[14], vp[15]),
        ),
        cameraPosition: d.vec3f(...matrices.cameraPosition),
        _pad: 0,
      });

      // 時間更新
      timeBuffer.write({
        time: now / 1000,
        deltaTime,
      });

      const encoder = device.createCommandEncoder();

      // Compute Pass: パーティクルと惑星の位置更新
      const computePass = encoder.beginComputePass();

      // 惑星更新
      computePass.setPipeline(planetComputePipeline);
      computePass.setBindGroup(0, planetComputeBindGroup);
      computePass.dispatchWorkgroups(Math.ceil(planetCount / 16));

      // パーティクル更新
      computePass.setPipeline(particleComputePipeline);
      computePass.setBindGroup(0, particleComputeBindGroup);
      computePass.dispatchWorkgroups(Math.ceil(totalParticles / 64));

      computePass.end();

      // Render Pass
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: context.getCurrentTexture().createView(),
            clearValue: { r: 0.02, g: 0.02, b: 0.05, a: 1 },
            loadOp: "clear",
            storeOp: "store",
          },
        ],
        depthStencilAttachment: {
          view: depthTexture.createView(),
          depthClearValue: 1.0,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });

      // 軌道線描画（惑星の後ろに表示）
      renderPass.setPipeline(orbitPipeline);
      renderPass.setBindGroup(0, orbitLineBindGroup);
      renderPass.draw(ORBIT_SEGMENTS * 6, PLANETS.length);  // 6頂点/セグメント（四角形）

      // 惑星描画
      renderPass.setPipeline(planetPipeline);
      renderPass.setBindGroup(0, planetBindGroup);
      renderPass.draw(6, planetCount);

      // パーティクル描画
      renderPass.setPipeline(particlePipeline);
      renderPass.setBindGroup(0, particleBindGroup);
      renderPass.draw(6, totalParticles);

      renderPass.end();

      device.queue.submit([encoder.finish()]);

      requestAnimationFrame(render);
    }

    // イベントリスナー
    speedSlider.addEventListener("input", () => {
      timeSpeed = parseInt(speedSlider.value) / 50;
      speedValue.textContent = `${timeSpeed.toFixed(1)}x`;
    });

    resetBtn.addEventListener("click", () => {
      camera.reset();
      speedSlider.value = "50";
      timeSpeed = 1.0;
      speedValue.textContent = "1.0x";
    });

    // レンダリング開始
    requestAnimationFrame(render);
  } catch (error) {
    showWebGPUError(app, error as Error);
  }
}

main();
