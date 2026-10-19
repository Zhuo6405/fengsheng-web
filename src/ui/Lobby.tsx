import { useState } from 'react'
import { FACTION_NAME, FACTION_SETUPS } from '../engine/data'
import type { GameConfig } from '../engine/types'
import { clearSavedHostRoom, savedHostRoom } from '../net/host'
import { normaliseCode } from '../net/protocol'
import { clearHistory, loadHistory } from './history'

const AI_NAMES = ['顧曉夢', '李寧玉', '吳志國', '白小年', '金生火', '王田香', '老周', '小方']

function storedName() {
  try {
    return localStorage.getItem('fs-name') ?? ''
  } catch {
    return ''
  }
}

export function Lobby({
  onLocal,
  onHost,
  onJoin,
}: {
  onLocal: (cfg: GameConfig) => void
  onHost: (name: string, restore: boolean) => void
  onJoin: (name: string, code: string) => void
}) {
  const urlRoom = normaliseCode(new URLSearchParams(location.search).get('room') ?? '')
  const [name, setName] = useState(storedName)
  const [code, setCode] = useState(urlRoom)
  const [count, setCount] = useState(5)
  const [setupIdx, setSetupIdx] = useState(0)
  const [alliance, setAlliance] = useState(false)
  const [nameErr, setNameErr] = useState(false)
  const [saved, setSaved] = useState(savedHostRoom)
  const [history, setHistory] = useState(loadHistory)
  const setups = FACTION_SETUPS[count]
  const setup = setups[Math.min(setupIdx, setups.length - 1)]

  const myName = () => {
    const n = name.trim()
    try {
      if (n) localStorage.setItem('fs-name', n)
    } catch {
      /* ignore */
    }
    return n
  }

  const needName = () => {
    const n = myName()
    if (!n) setNameErr(true)
    return n
  }

  const startLocal = () => {
    const me = myName() || '我'
    const names = [...AI_NAMES].sort(() => Math.random() - 0.5)
    onLocal({
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

      <label className={`field name-field ${nameErr ? 'has-error' : ''}`}>
        <span>你的名字</span>
        <input
          value={name}
          maxLength={12}
          placeholder="輸入暱稱"
          autoFocus={!!urlRoom}
          onChange={(e) => {
            setName(e.target.value)
            setNameErr(false)
          }}
        />
        {nameErr && <small className="err">連線遊戲需要先輸入名字。</small>}
      </label>

      {urlRoom && (
        <section className="lobby-panel is-invite" aria-label="受邀加入房間">
          <h2>你被邀請加入房間 {urlRoom}</h2>
          <button
            type="button"
            className="primary"
            onClick={() => {
              const n = needName()
              if (n) onJoin(n, urlRoom)
            }}
          >
            加入房間
          </button>
        </section>
      )}

      <section className="lobby-panel" aria-label="和朋友連線">
        <h2>和朋友連線</h2>
        <div className="online-row">
          <div>
            <button
              type="button"
              className="primary"
              onClick={() => {
                const n = needName()
                if (n) onHost(n, false)
              }}
            >
              建立房間
            </button>
            <p className="muted">你的瀏覽器會當房主，遊戲期間請不要關掉這個分頁。</p>
          </div>
          <form
            className="join"
            onSubmit={(e) => {
              e.preventDefault()
              const n = needName()
              const c = normaliseCode(code)
              if (n && c) onJoin(n, c)
            }}
          >
            <input value={code} onChange={(e) => setCode(normaliseCode(e.target.value))} placeholder="邀請碼" aria-label="邀請碼" maxLength={8} />
            <button type="submit" disabled={!normaliseCode(code)}>
              加入
            </button>
          </form>
        </div>
        {saved && (
          <div className="restore">
            <span>
              上次的房間 <b>{saved.code}</b>
              {saved.started && saved.state && !saved.state.result ? '（遊戲還在進行）' : ''}
            </span>
            <button type="button" onClick={() => onHost(saved.name, true)}>
              恢復房間
            </button>
            <button
              type="button"
              className="ghost"
              onClick={() => {
                clearSavedHostRoom()
                setSaved(null)
              }}
            >
              不用了
            </button>
          </div>
        )}
      </section>

      <section className="lobby-panel" aria-label="單機對戰 AI">
        <h2>單機對戰 AI</h2>
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
              <button key={i} type="button" className={`setup ${s === setup ? 'on' : ''}`} aria-pressed={s === setup} onClick={() => setSetupIdx(i)}>
                <b className="f-red">潛伏 {s[0]}</b>
                <b className="f-blue">軍情 {s[1]}</b>
                <b className="f-neutral">特工 {s[2]}</b>
              </button>
            ))}
          </div>
        </div>

        <label className={`check ${setup[2] < 2 ? 'is-disabled' : ''}`}>
          <input type="checkbox" checked={alliance && setup[2] >= 2} disabled={setup[2] < 2} onChange={(e) => setAlliance(e.target.checked)} />
          <span>
            特工同盟
            <small>一位特工宣告勝利時，所有特工一同勝利。需要至少兩位特工。</small>
          </span>
        </label>

        <button type="button" className="primary" onClick={startLocal}>
          開始單機遊戲
        </button>
      </section>

      {history.length > 0 && (
        <section className="lobby-panel" aria-label="最近對局">
          <h2>最近對局</h2>
          <ul className="history">
            {history.slice(0, 8).map((h) => (
              <li key={h.id}>
                <span className={`h-result ${h.won ? 'is-win' : ''}`}>{h.won ? '勝' : '敗'}</span>
                <span className="h-meta">
                  {new Date(h.at).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' })}．{h.mode === 'online' ? '連線' : '單機'}．
                  {h.players.length} 人．你是{h.myFaction ? FACTION_NAME[h.myFaction] : '—'}
                </span>
                <span className="h-reason">{h.reason}</span>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="ghost"
            onClick={() => {
              clearHistory()
              setHistory([])
            }}
          >
            清除紀錄
          </button>
        </section>
      )}

      <footer className="lobby-foot">目前版本：108 張基本規則。角色的機密任務已生效，角色技能尚未實裝。</footer>
    </main>
  )
}
