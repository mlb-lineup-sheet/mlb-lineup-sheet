# SPOTV LINEUP GENERATOR — Render公開手順

## 前提
- このリポジトリは **必ず GitHub Private** にする。
- `runtime/` にはSPOTV由来の辞書とExcelテンプレートが入るため、Public化しない。
- パスワードはファイルへ書かず、Renderの環境変数 `SPOTV_LINEUP_PASSWORD` に設定する。

## 1. GitHubへPrivateリポジトリとしてPush
GitHub Desktopでこのフォルダを追加し、Privateリポジトリを作成してPushする。
Publicにはしない。

## 2. RenderでWeb Service作成
1. RenderへGitHubアカウントを接続。
2. New → Web Service。
3. 上記Privateリポジトリを選択。
4. Dockerfileを自動検出させる。
5. Planは実戦利用ならStarter推奨。
6. Environmentに `SPOTV_LINEUP_PASSWORD` を追加し、本番用パスワードを設定。
7. Deploy。

`render.yaml` をBlueprintとして使う場合も `SPOTV_LINEUP_PASSWORD` の値はDashboard側で入力する。

## 3. 確認
- `https://<service>.onrender.com/api/health` → `{"ok":true}`
- トップURL → ログイン画面
- ログイン → TODAY'S GAMES
- 発表済み試合 → LINEUP
- EXCEL OUTPUT → xlsxダウンロード
- Excelで「スタメン」「守備」「表」「裏」を確認

## 公開版の重要点
- `HOST=0.0.0.0` で外部Web Serviceに対応。
- Renderの `PORT` を自動使用。
- 本番Cookieは `HttpOnly; SameSite=Strict; Secure`。
- `/api/*` はhealth/login/sessionを除きログイン必須。
- Excel生成物は本番では `/tmp/spotv-lineup-output` に一時保存。
- ダウンロードURLは30分で失効。
- `private/` と `outputs/` はDockerイメージへ入れない。
- MLBの年次キャッシュがなくても、対象試合のLive Feed内player情報でExcel生成できるようにしている。
