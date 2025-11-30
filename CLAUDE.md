# CLAUDE.md

このファイルは、Claude Code (claude.ai/code) がこのリポジトリで作業する際のガイダンスを提供します。

## プロジェクト概要

TypeGPUを紹介するアドベントカレンダー記事用のデモプロジェクト。TypeGPU（型安全なWebGPUライブラリ）とTypeScriptを使用したGPUアクセラレーショングラフィックスの複数デモページを含む。

## 開発コマンド

```bash
npm install    # 依存関係インストール
npm run dev    # 開発サーバー起動
npm run build  # TypeScriptチェック + 本番ビルド（dist/に出力）
npm run preview # 本番ビルドのプレビュー
```

## アーキテクチャ

- **マルチページViteアプリ** - デモ自動検出機能付き、`src/demos/{name}/`の新規デモはビルド時に自動登録
- **TypeGPU** (v0.4.6) - 型安全なWebGPUシェーダー/バッファ管理
- **GitHub Pagesデプロイ** - ベースパス`/typeGPU/`で設定済み

### 主要ファイル

- `src/main.ts` - デモ一覧ページ、新規デモ追加時は`demos`配列を更新
- `src/shared/webgpu-utils.ts` - WebGPU初期化ヘルパーとエラー表示
- `vite.config.ts` - デモ自動検出付きマルチページビルド設定
- `src/demos/{demo-name}/` - 各デモは独自の`index.html`と`main.ts`を持つ

### 新規デモの追加方法

1. `src/demos/{demo-name}/`に`index.html`と`main.ts`を作成
2. `src/main.ts`の`demos`配列にエントリを追加

## ブラウザ要件

WebGPUはChrome 113+、Edge 113+、またはFirefox Nightlyが必要。
