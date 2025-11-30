// デモ一覧の定義
// 新しいデモを追加する際はここに追記
interface Demo {
  id: string;
  title: string;
  description: string;
}

const demos: Demo[] = [
  {
    id: 'playground',
    title: 'Playground',
    description: 'TypeGPU練習用のサンドボックス',
  },
  {
    id: 'image-filter',
    title: 'Image Filter',
    description: 'GPUを使ったリアルタイム画像フィルター処理',
  },
  {
    id: 'particle-system',
    title: 'Particle System',
    description: '大量のパーティクルをGPUで並列処理',
  },
  {
    id: 'snow-dome',
    title: 'Snow Dome',
    description: '3Dスノードーム（パーティクル + インタラクション）',
  },
];

function renderDemoList() {
  const app = document.getElementById('app');
  if (!app) return;

  if (demos.length === 0) {
    app.innerHTML = '<p class="no-demos">デモはまだ追加されていません。</p>';
    return;
  }

  const list = document.createElement('ul');
  list.className = 'demo-list';

  for (const demo of demos) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = `/TypeGPUDemo/src/demos/${demo.id}/`;
    a.innerHTML = `
      <strong>${demo.title}</strong>
      <div class="demo-description">${demo.description}</div>
    `;
    li.appendChild(a);
    list.appendChild(li);
  }

  app.appendChild(list);
}

renderDemoList();
