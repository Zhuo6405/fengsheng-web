# 風聲（網頁版）

《風聲》108 張版本的網頁實作，和朋友連線或對戰 AI。

線上遊玩：https://zhuo6405.github.io/fengsheng-web/

## 目前進度

- [x] 規則引擎：108 張牌、三種傳遞方式、九種功能牌、鎖定／調虎離山／截獲／退回／破譯的時機窗口、後發先至的回應堆疊、死亡與勝負判定
- [x] 角色挑選與機密任務（打醬油的勝利條件）、醬油同盟
- [x] 單機對戰 AI（3–9 人）
- [ ] 多人連線（P2P，房主瀏覽器當伺服器）、文字聊天、語音
- [ ] 角色技能

## 開發

```bash
npm install
npm run dev      # 本地開發
npm test         # 規則測試 + AI 自動對戰
npm run sim 500  # 讓 AI 打 500 局看統計
```

推送到 `main` 後，GitHub Actions 會自動部署到 GitHub Pages（Settings → Pages → Source 選 GitHub Actions）。

## 程式結構

- `src/engine/` 規則引擎（純函式、可重現的亂數）。`viewFor()` 只產生某位玩家看得到的資訊，連線時房主只送這份資料。
- `src/ai/` AI，只讀取自己的視角，不偷看。
- `src/ui/` React 介面。

規則依據：[【風聲】規則及卡牌詳解](https://m102.nthu.edu.tw/~s102061202/Message_Rules_CN.pdf)。卡面為原創設計，不含原作美術。
