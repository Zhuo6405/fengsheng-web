import { useState } from 'react'
import { FACTION_SETUPS } from '../engine/data'
import type { GameConfig } from '../engine/types'

const AI_NAMES = ['顧曉夢', '李寧玉', '吳志國', '白小年', '金生火', '王田香', '老周', '小方']

export function Lobby({ onStart }: { onStart: (cfg: GameConfig) => void }) {
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem('fs-name') ?? ''
    } catch {
      return ''
    }
  })
  const [count, setCount] = useState(5)
  const [setupIdx, setSetupIdx] = useState(0)
  const [alliance, setAlliance] = useState(false)
  const setups = FACTION_SETUPS[count]
  const setup = setups[Math.min(setupIdx, setups.length - 1)]

  const start = () => {
    const me = name.trim() || '我'
    try {
      localStorage.setItem('fs-name', me)
    } catch {
      /* 無痕模式下存不了，沒關係 */
    }
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5)
    onStart({
      players: [
        { id: 'me', name: me, isAI: false },
        ...Array.from({ length: count - 1 }, (_, i) => ({ id: `ai${i}`, name: names[i], isAI: true })),
      ],
      factions: setup,
      neutralAlliance: alliance && setup[2] >= 2,
      seed: (Math.random() * 2 ** 31) | 0,
    })
  }

  return (
    <main className="lobby">
      <header className="lobby-title">
        <h1>風聲</h1>
        <p>諜戰推理卡牌遊戲．網頁版</p>
      </header>

      <section className="lobby-panel" aria-label="開始一局單機遊戲">
        <h2>單機對戰 AI</h2>

        <label className="field">
          <span>你的名字</span>
          <input value={name} maxLength={12} placeholder="輸入暱稱" onChange={(e) => setName(e.target.value)} />
        </label>

        <div className="field">
          <span>遊戲人數（含你）</span>
          <div className="segmented" role="radiogroup" aria-label="遊戲人數">
            {[3, 4, 5, 6, 7, 8, 9].map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={n === count}
                className={n === count ? 'on' : ''}
                onClick={() => {
                  setCount(n)
                  setSetupIdx(0)
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>陣營配置</span>
          <div className="setups">
            {setups.map((s, i) => (
              <button
                key={i}
                type="button"
                className={`setup ${s === setup ? 'on' : ''}`}
                aria-pressed={s === setup}
                onClick={() => setSetupIdx(i)}
              >
                <b className="f-red">潛伏 {s[0]}</b>
                <b className="f-blue">軍情 {s[1]}</b>
                <b className="f-neutral">醬油 {s[2]}</b>
              </button>
            ))}
          </div>
        </div>

        <label className={`check ${setup[2] < 2 ? 'is-disabled' : ''}`}>
          <input type="checkbox" checked={alliance && setup[2] >= 2} disabled={setup[2] < 2} onChange={(e) => setAlliance(e.target.checked)} />
          <span>
            醬油同盟
            <small>一位打醬油的玩家宣告勝利時，所有打醬油的玩家一同勝利。需要至少兩位打醬油的玩家。</small>
          </span>
        </label>

        <button type="button" className="primary" onClick={start}>
          開始遊戲
        </button>
      </section>

      <section className="lobby-panel is-muted" aria-label="多人連線">
        <h2>和朋友連線</h2>
        <p>建立房間、邀請碼、聊天與語音會在下一個版本加入。現在可以先熟悉規則和介面。</p>
      </section>

      <footer className="lobby-foot">
        目前版本：108 張基本規則。角色的機密任務已生效，角色技能尚未實裝。
      </footer>
    </main>
  )
}
