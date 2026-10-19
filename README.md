# 風聲（網頁版）

《風聲》108 張版本的網頁實作，和朋友連線或對戰 AI。

線上遊玩：https://zhuo6405.github.io/fengsheng-web/

## 目前進度

- [x] 規則引擎：108 張牌、三種傳遞方式、九種功能牌、鎖定／調虎離山／截獲／退回／破譯的時機窗口、後發先至的回應堆疊、死亡與勝負判定
- [x] 角色挑選與機密任務（打醬油的勝利條件）、醬油同盟
- [x] 單機對戰 AI（3–9 人）
- [x] 多人連線（P2P，房主瀏覽器當伺服器）：邀請碼／邀請連結、人不夠由電腦補位、斷線 15 秒後 AI 代打、重新整理可回到原座位、房主重新整理可恢復房間
- [x] 文字聊天、語音（WebRTC，所有開麥克風的人互連）
- [x] 回應時機倒數計時（逾時自動略過）、對局紀錄存在瀏覽器
- [ ] 角色技能

## 開發

```bash
npm install
npm run dev      # 本地開發
npm test         # 規則測試 + AI 自動對戰
npm run sim 500  # 讓 AI 打 500 局看統計

# 本機測連線（不依賴 PeerJS 公用配對伺服器）
node scripts/peer-server.mjs
# 再開 http://localhost:5173/fengsheng-web/?peer=127.0.0.1:9000
```

## 連線架構

- 配對：預設使用 PeerJS 的免費公用配對伺服器（只負責讓雙方找到彼此），遊戲資料走瀏覽器之間的 P2P。
- 房主的瀏覽器持有完整的遊戲狀態，每位玩家只收到自己看得到的資訊。
- 少數網路環境（例如部分宿舍或公司網路）會擋 P2P，需要再加一台 TURN 中繼伺服器。

推送到 `main` 後，GitHub Actions 會自動部署到 GitHub Pages（Settings → Pages → Source 選 GitHub Actions）。

## 程式結構

- `src/engine/` 規則引擎（純函式、可重現的亂數）。`viewFor()` 只產生某位玩家看得到的資訊，連線時房主只送這份資料。
- `src/ai/` AI，只讀取自己的視角，不偷看。
- `src/net/` 連線：`host.ts`（房主）、`guest.ts`（玩家）、`runner.ts`（AI 排程與計時）、`voice.ts`（語音）。
- `src/ui/` React 介面。

規則依據：[【風聲】規則及卡牌詳解](https://m102.nthu.edu.tw/~s102061202/Message_Rules_CN.pdf)。卡面為原創設計，不含原作美術。
