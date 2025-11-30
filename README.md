# TypeGPU Demo Project

TypeGPU紹介記事用のデモプロジェクト

## プロジェクト概要

親会社主催のアドベントカレンダー用の記事として、TypeGPUを紹介するためのデモサイト。

### 記事構成

1. **WebGPUとは**（簡潔に）
   - GPUを直接操作できるWeb API
   - できること：並列計算、3D描画、機械学習推論など

2. **WebGPUの課題**
   - WGSLの学習コスト
   - バッファ管理が煩雑
   - 型安全性がない（JSとシェーダー間）

3. **TypeGPUの解決策**
   - TypeScriptでシェーダーを記述
   - 型安全なデータバインディング
   - ボイラープレートの削減
   - Before/After（生WebGPU vs TypeGPU）のコード比較

4. **デモ（実際に動くもの）**

### デモ一覧

1. **Playground** - TypeGPU練習用のサンドボックス
2. **Image Filter** - GPUを使ったリアルタイム画像フィルター処理
3. **Particle System** - 大量のパーティクルをGPUで並列処理
4. **Snow Dome** - 3Dスノードーム（クリスマステーマ、総合デモ）

## プロジェクト構成

```
typeGPU/
├── package.json
├── tsconfig.json
├── vite.config.ts          # GitHub Pages用設定、デモ自動検出
├── index.html              # 一覧ページ
├── src/
│   ├── main.ts             # デモ一覧管理
│   ├── demos/
│   │   ├── playground/     # 練習用
│   │   ├── image-filter/   # 画像フィルター
│   │   ├── particle-system/# パーティクル
│   │   └── snow-dome/      # スノードーム
│   └── shared/
│       └── webgpu-utils.ts # 共通ユーティリティ
└── public/
```

## セットアップ

```bash
npm install
```

## 開発

```bash
npm run dev
```

## ビルド（GitHub Pages用）

```bash
npm run build
```

ビルド結果は `dist/` に出力されます。

## 新しいデモの追加方法

1. `src/demos/{demo-name}/` ディレクトリを作成
2. `index.html` と `main.ts` を追加
3. `src/main.ts` の `demos` 配列に情報を追記

```typescript
{
  id: 'demo-name',
  title: 'Demo Title',
  description: 'デモの説明',
}
```

## デプロイ（GitHub Pages）

- リポジトリ名: `typeGPU`
- `vite.config.ts` の `base` を設定済み
- `gh-pages` ブランチまたは `docs/` フォルダにデプロイ

## 技術スタック

- **TypeGPU**: 型安全なWebGPUライブラリ
- **Vite**: 開発サーバー・ビルドツール
- **TypeScript**: 型安全性

## 実装状況

- [x] プロジェクト構成
- [x] デモディレクトリ作成
- [ ] Playground実装
- [ ] Image Filter実装
- [ ] Particle System実装
- [ ] Snow Dome実装

## メモ

- WebGPU対応ブラウザ：Chrome 113+, Edge 113+, Firefox Nightly等
- TypeGPUバージョン: 0.4.0
