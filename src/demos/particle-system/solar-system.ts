/**
 * 太陽系データ定義
 */

// 惑星の定義
export interface PlanetData {
  name: string;
  radius: number;          // 惑星の半径
  orbitRadius: number;     // 軌道半径
  orbitSpeed: number;      // 公転速度（rad/s）
  color: [number, number, number];  // RGB (0-1)
  hasRing?: boolean;       // 輪を持つか
  satellites?: SatelliteData[];  // 衛星
}

export interface SatelliteData {
  name: string;
  radius: number;
  orbitRadius: number;     // 親惑星からの距離
  orbitSpeed: number;
  color: [number, number, number];
}

// デフォルメされたサイズ・距離
// 実際の比率だと見えないので調整
export const SUN_RADIUS = 30;

export const PLANETS: PlanetData[] = [
  {
    name: 'Mercury',
    radius: 2,
    orbitRadius: 60,
    orbitSpeed: 0.8,
    color: [0.7, 0.7, 0.7],  // 灰色
  },
  {
    name: 'Venus',
    radius: 4,
    orbitRadius: 90,
    orbitSpeed: 0.6,
    color: [0.9, 0.8, 0.6],  // 黄白色
  },
  {
    name: 'Earth',
    radius: 4.2,
    orbitRadius: 120,
    orbitSpeed: 0.5,
    color: [0.2, 0.5, 0.9],  // 青
    satellites: [
      {
        name: 'Moon',
        radius: 1,
        orbitRadius: 10,
        orbitSpeed: 2,
        color: [0.8, 0.8, 0.8],
      },
    ],
  },
  {
    name: 'Mars',
    radius: 3,
    orbitRadius: 160,
    orbitSpeed: 0.4,
    color: [0.8, 0.4, 0.2],  // 赤茶色
  },
  {
    name: 'Jupiter',
    radius: 14,
    orbitRadius: 240,
    orbitSpeed: 0.2,
    color: [0.8, 0.7, 0.5],  // 縞模様風
    satellites: [
      { name: 'Io', radius: 1.2, orbitRadius: 22, orbitSpeed: 3, color: [0.9, 0.8, 0.4] },
      { name: 'Europa', radius: 1, orbitRadius: 28, orbitSpeed: 2.5, color: [0.8, 0.8, 0.9] },
      { name: 'Ganymede', radius: 1.5, orbitRadius: 36, orbitSpeed: 2, color: [0.7, 0.7, 0.7] },
      { name: 'Callisto', radius: 1.3, orbitRadius: 44, orbitSpeed: 1.5, color: [0.5, 0.5, 0.5] },
    ],
  },
  {
    name: 'Saturn',
    radius: 12,
    orbitRadius: 340,
    orbitSpeed: 0.15,
    color: [0.9, 0.85, 0.6],  // 黄土色
    hasRing: true,
    satellites: [
      { name: 'Titan', radius: 1.5, orbitRadius: 35, orbitSpeed: 1.8, color: [0.8, 0.7, 0.4] },
    ],
  },
  {
    name: 'Uranus',
    radius: 7,
    orbitRadius: 440,
    orbitSpeed: 0.1,
    color: [0.6, 0.85, 0.9],  // 水色
  },
  {
    name: 'Neptune',
    radius: 6.5,
    orbitRadius: 540,
    orbitSpeed: 0.08,
    color: [0.3, 0.5, 0.9],  // 青
  },
];

// 土星の輪のパラメータ
export const SATURN_RING = {
  innerRadius: 15,   // 内側半径（惑星半径より少し大きい）
  outerRadius: 28,   // 外側半径
  particleCount: 20000,
  color: [0.85, 0.8, 0.7, 0.6] as [number, number, number, number],  // RGBA
};

// 小惑星帯のパラメータ
export const ASTEROID_BELT = {
  innerRadius: 180,   // 火星と木星の間
  outerRadius: 220,
  particleCount: 8000,
  color: [0.5, 0.5, 0.5, 0.8] as [number, number, number, number],
};

// 背景の星
export const BACKGROUND_STARS = {
  count: 3000,
  minDistance: 800,
  maxDistance: 2000,
};

// 太陽の色
export const SUN_COLOR: [number, number, number] = [1.0, 0.9, 0.5];
