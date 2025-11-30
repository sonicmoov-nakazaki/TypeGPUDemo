/**
 * WebGPUの初期化ユーティリティ
 */
export async function initWebGPU(canvas: HTMLCanvasElement) {
  if (!navigator.gpu) {
    throw new Error('WebGPU is not supported in this browser');
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    throw new Error('Failed to get GPU adapter');
  }

  const device = await adapter.requestDevice();
  const context = canvas.getContext('webgpu');
  if (!context) {
    throw new Error('Failed to get WebGPU context');
  }

  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({
    device,
    format,
    alphaMode: 'premultiplied',
  });

  return { adapter, device, context, format };
}

/**
 * WebGPU非対応時のエラー表示
 */
export function showWebGPUError(container: HTMLElement, error: Error) {
  container.innerHTML = `
    <div style="
      padding: 2rem;
      background: #1a1a1a;
      border: 1px solid #f87171;
      border-radius: 8px;
      color: #f87171;
    ">
      <h2>WebGPU Error</h2>
      <p>${error.message}</p>
      <p style="color: #888; font-size: 0.9rem;">
        WebGPUをサポートするブラウザ（Chrome 113+, Edge 113+, Firefox Nightly等）をお使いください。
      </p>
    </div>
  `;
}
