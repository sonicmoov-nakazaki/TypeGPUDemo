import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readdirSync, statSync } from 'fs';

// デモディレクトリを自動検出
function getDemoEntries() {
  const demosDir = resolve(__dirname, 'src/demos');
  const entries: Record<string, string> = {};

  try {
    const demos = readdirSync(demosDir);
    for (const demo of demos) {
      const demoPath = resolve(demosDir, demo);
      if (statSync(demoPath).isDirectory()) {
        const htmlPath = resolve(demoPath, 'index.html');
        entries[demo] = htmlPath;
      }
    }
  } catch {
    // demosディレクトリがまだ存在しない場合は空のまま
  }

  return entries;
}

export default defineConfig({
  base: '/TypeGPUDemo/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        ...getDemoEntries(),
      },
    },
  },
});
