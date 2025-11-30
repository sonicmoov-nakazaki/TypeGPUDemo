/**
 * 3Dカメラ操作モジュール
 * 球面座標でカメラ位置を管理し、ドラッグ・ズーム操作を提供
 */

export interface CameraState {
  distance: number;    // カメラと注視点の距離
  theta: number;       // 水平角（ラジアン）
  phi: number;         // 仰角（ラジアン）
  target: [number, number, number];  // 注視点
}

export interface CameraMatrices {
  view: Float32Array;
  projection: Float32Array;
  viewProjection: Float32Array;
  cameraPosition: [number, number, number];
}

const DEFAULT_STATE: CameraState = {
  distance: 500,
  theta: Math.PI / 4,
  phi: Math.PI / 6,
  target: [0, 0, 0],
};

export function createCamera(canvas: HTMLCanvasElement, initialState?: Partial<CameraState>) {
  const state: CameraState = { ...DEFAULT_STATE, ...initialState };

  // 制限値
  const MIN_DISTANCE = 50;
  const MAX_DISTANCE = 2000;
  const MIN_PHI = -Math.PI / 2 + 0.01;  // 下から見上げる
  const MAX_PHI = Math.PI / 2 - 0.01;   // 上から見下ろす

  // ドラッグ状態
  let isRotating = false;   // 左ドラッグ: 回転
  let isPanning = false;    // 右ドラッグ or Shift+左ドラッグ: パン
  let lastX = 0;
  let lastY = 0;

  // マウスイベント
  canvas.addEventListener('mousedown', (e) => {
    lastX = e.clientX;
    lastY = e.clientY;

    if (e.button === 2 || e.shiftKey) {
      // 右クリック or Shift+左クリック: パン
      isPanning = true;
      canvas.style.cursor = 'move';
    } else if (e.button === 0) {
      // 左クリック: 回転
      isRotating = true;
      canvas.style.cursor = 'grabbing';
    }
  });

  // 右クリックメニュー無効化
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  });

  window.addEventListener('mouseup', () => {
    isRotating = false;
    isPanning = false;
    canvas.style.cursor = 'grab';
  });

  window.addEventListener('mousemove', (e) => {
    const deltaX = e.clientX - lastX;
    const deltaY = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;

    if (isRotating) {
      // 回転
      const sensitivity = 0.005;
      state.theta -= deltaX * sensitivity;
      state.phi += deltaY * sensitivity;

      // 角度制限
      state.phi = Math.max(MIN_PHI, Math.min(MAX_PHI, state.phi));
    } else if (isPanning) {
      // パン（注視点の移動）
      const panSpeed = state.distance * 0.002;

      // カメラのright/upベクトルに沿って移動
      const cosTheta = Math.cos(state.theta);
      const sinTheta = Math.sin(state.theta);

      // right方向（水平）
      const rightX = sinTheta;
      const rightZ = -cosTheta;

      // up方向（カメラのphi依存）
      const cosPhi = Math.cos(state.phi);
      const sinPhi = Math.sin(state.phi);
      const upX = -sinPhi * cosTheta;
      const upY = cosPhi;
      const upZ = -sinPhi * sinTheta;

      state.target[0] += (rightX * deltaX + upX * deltaY) * panSpeed;
      state.target[1] += upY * deltaY * panSpeed;
      state.target[2] += (rightZ * deltaX + upZ * deltaY) * panSpeed;
    }
  });

  // ホイールでズーム
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomSpeed = state.distance * 0.1;
    state.distance += e.deltaY > 0 ? zoomSpeed : -zoomSpeed;
    state.distance = Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, state.distance));
  }, { passive: false });

  // ダブルクリックでリセット
  canvas.addEventListener('dblclick', () => {
    state.distance = DEFAULT_STATE.distance;
    state.theta = DEFAULT_STATE.theta;
    state.phi = DEFAULT_STATE.phi;
    state.target = [...DEFAULT_STATE.target];
  });

  // 初期カーソル
  canvas.style.cursor = 'grab';

  /**
   * カメラ位置を球面座標から計算
   */
  function getCameraPosition(): [number, number, number] {
    const x = state.target[0] + state.distance * Math.cos(state.phi) * Math.cos(state.theta);
    const y = state.target[1] + state.distance * Math.sin(state.phi);
    const z = state.target[2] + state.distance * Math.cos(state.phi) * Math.sin(state.theta);
    return [x, y, z];
  }

  /**
   * ビュー行列を計算（lookAt）
   */
  function getViewMatrix(): Float32Array {
    const eye = getCameraPosition();
    const target = state.target;
    const up: [number, number, number] = [0, 1, 0];

    // forward = normalize(target - eye)
    const fx = target[0] - eye[0];
    const fy = target[1] - eye[1];
    const fz = target[2] - eye[2];
    const fLen = Math.sqrt(fx * fx + fy * fy + fz * fz);
    const forward = [fx / fLen, fy / fLen, fz / fLen];

    // right = normalize(cross(forward, up))
    const rx = forward[1] * up[2] - forward[2] * up[1];
    const ry = forward[2] * up[0] - forward[0] * up[2];
    const rz = forward[0] * up[1] - forward[1] * up[0];
    const rLen = Math.sqrt(rx * rx + ry * ry + rz * rz);
    const right = [rx / rLen, ry / rLen, rz / rLen];

    // newUp = cross(right, forward)
    const newUp = [
      right[1] * forward[2] - right[2] * forward[1],
      right[2] * forward[0] - right[0] * forward[2],
      right[0] * forward[1] - right[1] * forward[0],
    ];

    // View matrix (column-major for WebGPU)
    return new Float32Array([
      right[0], newUp[0], -forward[0], 0,
      right[1], newUp[1], -forward[1], 0,
      right[2], newUp[2], -forward[2], 0,
      -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2]),
      -(newUp[0] * eye[0] + newUp[1] * eye[1] + newUp[2] * eye[2]),
      (forward[0] * eye[0] + forward[1] * eye[1] + forward[2] * eye[2]),
      1,
    ]);
  }

  /**
   * 透視投影行列を計算
   */
  function getProjectionMatrix(aspect: number, fov = Math.PI / 4, near = 1, far = 5000): Float32Array {
    const f = 1 / Math.tan(fov / 2);
    const rangeInv = 1 / (near - far);

    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * rangeInv, -1,
      0, 0, near * far * rangeInv * 2, 0,
    ]);
  }

  /**
   * 行列の乗算
   */
  function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
    const result = new Float32Array(16);
    for (let i = 0; i < 4; i++) {
      for (let j = 0; j < 4; j++) {
        result[i * 4 + j] =
          a[0 * 4 + j] * b[i * 4 + 0] +
          a[1 * 4 + j] * b[i * 4 + 1] +
          a[2 * 4 + j] * b[i * 4 + 2] +
          a[3 * 4 + j] * b[i * 4 + 3];
      }
    }
    return result;
  }

  /**
   * カメラ行列を取得
   */
  function getMatrices(): CameraMatrices {
    const aspect = canvas.width / canvas.height;
    const view = getViewMatrix();
    const projection = getProjectionMatrix(aspect);
    const viewProjection = multiplyMatrices(projection, view);

    return {
      view,
      projection,
      viewProjection,
      cameraPosition: getCameraPosition(),
    };
  }

  return {
    getMatrices,
    getState: () => ({ ...state }),
    setState: (newState: Partial<CameraState>) => Object.assign(state, newState),
    reset: () => Object.assign(state, DEFAULT_STATE),
  };
}

export type Camera = ReturnType<typeof createCamera>;
