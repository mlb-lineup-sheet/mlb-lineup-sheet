# SPOTV LINEUP GENERATOR — Render公開手順

## 前提
- このリポジトリは **必ず GitHub Private** にする。
- `runtime/` にはSPOTV由来の辞書とExcelテンプレートが入るため、Public化しない。
- パスワード認証は廃止済み。トップURLから直接試合一覧を表示する。

## 1. GitHubへPrivateリポジトリとしてPush
GitHub Desktopでこのフォルダを追加し、Privateリポジトリを作成してPushする。
Publicにはしない。

## 2. RenderでWeb Service作成
1. RenderへGitHubアカウントを接続。
2. New → Web Service。
3. 上記Privateリポジトリを選択。
4. Dockerfileを自動検出させる。
5. Planは実戦利用ならStarter推奨。
6. Deploy。

既存の `SPOTV_LINEUP_PASSWORD` 環境変数は未使用。残っていても認証は行わない。

## 3. 確認
- `https://<service>.onrender.com/api/health` → `{"ok":true}`
- トップURL → パスワード入力なしで TODAY'S GAMES
- 発表済み試合 → LINEUP
- EXCEL OUTPUT → xlsxダウンロード
- Excelで「スタメン」「守備」「表」「裏」を確認

## 公開版の重要点
- `HOST=0.0.0.0` で外部Web Serviceに対応。
- Renderの `PORT` を自動使用。
- 試合・ロースター・Excel生成APIは認証なしで利用可能。
- 旧画面との互換性のため `/api/session` は `authenticated: true` を返す。
- Excel生成物は本番では `/tmp/spotv-lineup-output` に一時保存。
- ダウンロードURLは30分で失効。
- `private/` と `outputs/` はDockerイメージへ入れない。
- MLBの年次キャッシュがなくても、対象試合のLive Feed内player情報でExcel生成できるようにしている。
