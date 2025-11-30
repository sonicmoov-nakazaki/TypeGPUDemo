import { showWebGPUError } from '../../shared/webgpu-utils';

async function main() {
  const app = document.getElementById('app');
  if (!app) return;

  try {
    // TODO: Implement particle system demo
    app.innerHTML = '<p>Particle System demo - Coming soon</p>';
  } catch (error) {
    showWebGPUError(app, error as Error);
  }
}

main();
