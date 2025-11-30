# 太陽系パーティクルデモ 設計書

## 概要
TypeGPUのCompute Shaderを活用した3D太陽系シミュレーション。
土星の輪や小惑星帯をパーティクルで表現し、GPUの並列計算能力をショーケースする。

## 構成要素

### 天体
| 天体 | 表現方法 | 備考 |
|------|----------|------|
| 太陽 | 球体（発光） | 中心、黄色〜オレンジ |
| 水星 | 球体 | 灰色、小さい |
| 金星 | 球体 | 黄白色 |
| 地球 | 球体 | 青 + 衛星（月） |
| 火星 | 球体 | 赤茶色 |
| 木星 | 球体 | 縞模様風、大きい + 主要衛星 |
| 土星 | 球体 + 輪 | 輪はパーティクル |
| 天王星 | 球体 | 水色 |
| 海王星 | 球体 | 青 |

### パーティクル群（Compute Shader）
| 種類 | 粒子数 | 用途 |
|------|--------|------|
| 土星の輪 | 10,000〜50,000 | メインのショーケース |
| 小惑星帯 | 5,000〜10,000 | 火星-木星間 |
| 背景の星 | 2,000〜5,000 | 遠方の恒星 |

## データ構造

```typescript
// 惑星データ
const Planet = d.struct({
  position: d.vec3f,      // 現在位置
  radius: d.f32,          // 半径
  orbitRadius: d.f32,     // 軌道半径
  orbitSpeed: d.f32,      // 公転速度
  angle: d.f32,           // 現在の角度
  color: d.vec3f,         // 色
});

// パーティクル（輪・小惑星・星）
const Particle = d.struct({
  position: d.vec3f,      // 位置
  velocity: d.vec3f,      // 速度（軌道運動用）
  color: d.vec4f,         // 色 + 透明度
  size: d.f32,            // 粒子サイズ
  orbitCenter: d.vec3f,   // 軌道中心（土星の輪用）
  orbitRadius: d.f32,     // 軌道半径
});

// カメラ
const Camera = d.struct({
  position: d.vec3f,
  target: d.vec3f,
  up: d.vec3f,
  fov: d.f32,
  aspect: d.f32,
  near: d.f32,
  far: d.f32,
});

// 時間・シミュレーションパラメータ
const SimParams = d.struct({
  deltaTime: d.f32,
  totalTime: d.f32,
});
```

## Compute Shader

### 1. 惑星軌道更新
```wgsl
// 各惑星の公転を計算
@compute @workgroup_size(8)
fn updatePlanets(@builtin(global_invocation_id) id: vec3u) {
  let planet = &planets[id.x];
  planet.angle += planet.orbitSpeed * params.deltaTime;
  planet.position.x = cos(planet.angle) * planet.orbitRadius;
  planet.position.z = sin(planet.angle) * planet.orbitRadius;
}
```

### 2. パーティクル更新（土星の輪・小惑星帯）
```wgsl
// 軌道上を周回
@compute @workgroup_size(64)
fn updateParticles(@builtin(global_invocation_id) id: vec3u) {
  let p = &particles[id.x];
  // 軌道中心の周りを回転
  let angle = atan2(p.position.z - p.orbitCenter.z, p.position.x - p.orbitCenter.x);
  let newAngle = angle + p.velocity.x * params.deltaTime;
  p.position.x = p.orbitCenter.x + cos(newAngle) * p.orbitRadius;
  p.position.z = p.orbitCenter.z + sin(newAngle) * p.orbitRadius;
}
```

## レンダリング

### パイプライン構成
1. **背景の星**: ポイントスプライト（静的）
2. **小惑星帯**: ポイントスプライト
3. **惑星**: 球体メッシュ（インスタンシング）
4. **土星の輪**: ポイントスプライト（半透明）
5. **太陽**: 球体 + 発光エフェクト（additive blending）

### 3D描画
- 透視投影（Perspective projection）
- ビュー行列（カメラ位置から計算）
- 深度バッファ使用

## カメラ操作

### マウス操作
| 操作 | 動作 |
|------|------|
| ドラッグ | 視点回転（球面座標） |
| ホイール | ズームイン/アウト |
| ダブルクリック | リセット or 惑星フォーカス |

### カメラ実装
```typescript
// 球面座標でカメラ位置を管理
let cameraDistance = 100;
let cameraTheta = Math.PI / 4;  // 水平角
let cameraPhi = Math.PI / 6;    // 仰角

function updateCamera() {
  camera.position = {
    x: cameraDistance * Math.cos(cameraPhi) * Math.cos(cameraTheta),
    y: cameraDistance * Math.sin(cameraPhi),
    z: cameraDistance * Math.cos(cameraPhi) * Math.sin(cameraTheta),
  };
  camera.target = { x: 0, y: 0, z: 0 };  // 太陽を見る
}
```

## ファイル構成

```
particle-system/
├── main.ts              # エントリーポイント、UI、メインループ
├── solar-system.ts      # 太陽系データ・初期化
├── shaders/
│   ├── compute.wgsl     # Compute Shader（軌道計算）
│   └── render.wgsl      # 頂点・フラグメントシェーダー
├── camera.ts            # カメラ操作
└── particles.ts         # パーティクル生成・管理
```

## UI

```
┌─────────────────────────────────────────┐
│  [時間速度スライダー]  [リセットボタン]    │
├─────────────────────────────────────────┤
│                                         │
│                                         │
│            3D太陽系ビュー                │
│          (Canvas - WebGPU)              │
│                                         │
│                                         │
├─────────────────────────────────────────┤
│  ドラッグ: 視点回転 | ホイール: ズーム    │
└─────────────────────────────────────────┘
```

## 実装ステップ

### Phase 1: 基盤
1. Canvas + WebGPU初期化
2. カメラ操作（ドラッグ・ズーム）
3. 基本的な3D描画パイプライン

### Phase 2: 惑星
4. 太陽と8惑星の描画（球体）
5. 惑星の公転（Compute Shader）
6. 惑星の色・サイズ設定

### Phase 3: パーティクル
7. 土星の輪（パーティクル生成・描画）
8. 小惑星帯
9. 背景の星

### Phase 4: 仕上げ
10. 衛星（月、木星・土星の衛星）
11. UIコントロール
12. エフェクト調整（発光など）

## 定数（デフォルメ値）

```typescript
// 相対的なサイズ（太陽=30として）
const SIZES = {
  sun: 30,
  mercury: 1.5,
  venus: 3,
  earth: 3.2,
  mars: 2,
  jupiter: 12,
  saturn: 10,
  uranus: 5,
  neptune: 4.8,
};

// 軌道半径（デフォルメ）
const ORBITS = {
  mercury: 50,
  venus: 70,
  earth: 95,
  mars: 130,
  jupiter: 200,
  saturn: 280,
  uranus: 360,
  neptune: 430,
};
```
