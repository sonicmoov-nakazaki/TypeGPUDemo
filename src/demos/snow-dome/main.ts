import { showWebGPUError } from '../../shared/webgpu-utils';

async function main() {
  const app = document.getElementById('app');
  if (!app) return;

  try {
    // TODO: Implement snow dome demo
    app.innerHTML = '<p>Snow Dome demo - Coming soon</p>';
  } catch (error) {
    showWebGPUError(app, error as Error);
  }
}

main();
