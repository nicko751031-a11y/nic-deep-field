# 部署說明

此倉庫是 `nicko751031-a11y/NIC` 的 `space/` 目錄的公開鏡像，只含網站檔案（NASA 公眾領域貼圖、CC BY-SA 星表、MIT 的 three.js 與本專案程式碼），不含任何私人資料。
推送到 `main` 會由 GitHub Actions 自動部署到 GitHub Pages。

## 測試預覽（`preview/` 子目錄）

- 正式站＝本倉庫根目錄（私有 `main` 的 `space/`）。
- `preview/` 是**未經驗收的整合候選**（私有倉庫 `claude/integration-test` 分支的 `space/`），網址 `https://nicko751031-a11y.github.io/nic-deep-field/preview/`，供負責人在 iPhone Safari／加入主畫面實機測試。它與根目錄各自完整（貼圖、資料、程式都是獨立副本），互不影響。
- 候選通過驗收並合併進私有 `main` 後，同步根目錄並刪除 `preview/`；候選被否決時直接刪除 `preview/` 即可，正式站不受影響。
- `preview/` 的內容以私有倉庫的 commit SHA 為準（見同步 commit 訊息），不要直接在此修改。
