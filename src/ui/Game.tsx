import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CHAR_BY_ID, COLOUR_NAME, FACTION_NAME, KIND_DESC, KIND_NAME, METHOD_NAME } from '../engine/data'
import type { Action, Card, GameConfig, LegalPlay } from '../engine/types'
import type { GameView } from '../engine/view'
import { CardFace, FactionBadge, IntelChip, SEAL, Seat } from './components'
import { useLocalController, useSecondsLeft, type GameController, type Social } from './controller'
import { recordResult } from './history'
import { ChatPanel, VoiceControls } from './social'

export function LocalGame({ config, onExit }: { config: GameConfig; onExit: () => void }) {
  const ctl = useLocalController(config)
  return (
    <GameScreen
      ctl={ctl}
      onExit={onExit}
      historyId={`local-${config.seed}`}
      resultActions={
        <button type="button" className="primary" onClick={onExit}>
          回到大廳
        </button>
      }
    />
  )
}

export function GameScreen({
  ctl,
  social,
  onExit,
  exitLabel = '離開',
  resultActions,
  historyId,
  topExtra,
}: {
  ctl: GameController
  social?: Social
  onExit: () => void
  exitLabel?: string
  resultActions: ReactNode
  historyId: string
  topExtra?: ReactNode
}) {
  const v = ctl.view
  useEffect(() => {
    if (v.result) recordResult(v, social ? 'online' : 'local', historyId)
  }, [v, social, historyId])
  if (v.phase === 'choose_character' && v.decision?.type === 'choose_character') {
    return <CharacterPick v={v} act={ctl.act} deadline={ctl.deadline} />
  }
  if (v.phase === 'choose_character') {
    return (
      <main className="pick">
        <p className="pick-wait">等待其他玩家挑選角色…</p>
      </main>
    )
  }
  return <Table ctl={ctl} social={social} onExit={onExit} exitLabel={exitLabel} resultActions={resultActions} topExtra={topExtra} />
}

function CharacterPick({ v, act, deadline }: { v: GameView; act: (a: Action) => void; deadline: number | null }) {
  const left = useSecondsLeft(deadline)
  return (
    <main className="pick">
      <h1>挑選你的角色</h1>
      <p className="pick-sub">
        選完角色後才會發身份牌。潛伏角色開局蓋伏，其他角色公開。
        {left != null && <span className="countdown">剩 {left} 秒</span>}
      </p>
      <div className="pick-row">
        {v.myCharOptions.map((id) => {
          const c = CHAR_BY_ID[id]
          return (
            <button key={id} type="button" className="char-card" onClick={() => act({ type: 'choose_character', character: id })}>
              <span className="char-name">{c.name}</span>
              <span className="char-meta">
                {c.hidden ? '潛伏角色．開局蓋伏' : '公開角色'}．{c.gender === 'male' ? '男' : c.gender === 'female' ? '女' : '男女皆是'}
              </span>
              <span className="char-sec">機密任務</span>
              <span className="char-text">{c.missionText}</span>
              <span className="char-sec">角色技能（尚未實裝）</span>
              <ul>
                {c.skills.map((sk) => (
                  <li key={sk}>{sk}</li>
                ))}
              </ul>
              <span className="char-go">選擇{c.name}</span>
            </button>
          )
        })}
      </div>
    </main>
  )
}

function seatPositions(n: number, me: number) {
  // 自己在正下方，其他人沿橢圓排列
  return Array.from({ length: n }, (_, seat) => {
    const k = (seat - me + n) % n
    const a = Math.PI / 2 + (2 * Math.PI * k) / n
    return { left: `${50 + 41 * Math.cos(a)}%`, top: `${50 + 39 * Math.sin(a)}%` }
  })
}

/** 「本回合都略過」：自動略過與自己無關的回應時機 */
function useAutoSkip(v: GameView, act: (a: Action) => void) {
  const [skipTurn, setSkipTurn] = useState<number | null>(null)
  const d = v.decision
  const skipping = skipTurn === v.turnNo
  useEffect(() => {
    if (!skipping || d?.type !== 'priority') return
    const top = v.stack[v.stack.length - 1]
    const aboutMe = (d.ctx === 'hopB' && v.trans?.holder === v.me) || (top && top.target === v.me)
    if (aboutMe) return
    const id = setTimeout(() => act({ type: 'pass' }), 150)
    return () => clearTimeout(id)
  }, [skipping, d, v, act])
  return { skipping, skip: () => setSkipTurn(v.turnNo), stop: () => setSkipTurn(null) }
}

type Skip = ReturnType<typeof useAutoSkip>

function Table({
  ctl,
  social,
  onExit,
  exitLabel,
  resultActions,
  topExtra,
}: {
  ctl: GameController
  social?: Social
  onExit: () => void
  exitLabel: string
  resultActions: ReactNode
  topExtra?: ReactNode
}) {
  const v = ctl.view
  const [sel, setSel] = useState<number | null>(null)
  const [tab, setTab] = useState<'log' | 'chat'>('log')
  const [seenChat, setSeenChat] = useState(0)
  const pos = useMemo(() => seatPositions(v.players.length, v.me), [v.players.length, v.me])
  const me = v.players[v.me]
  const myChar = me.character ? CHAR_BY_ID[me.character] : null
  const d = v.decision
  const skip = useAutoSkip(v, ctl.act)

  // 手牌變動或時機改變時，取消選取
  const decKey = `${d?.type}-${v.turnNo}-${v.stack.length}-${v.trans?.stage}-${v.trans?.holder}`
  useEffect(() => setSel(null), [decKey])
  const selCard = v.hand.find((c) => c.id === sel) ?? null
  const legalById = useMemo(() => new Map(v.legal.map((l) => [l.card, l])), [v.legal])

  const chatLen = social?.chat.length ?? 0
  useEffect(() => {
    if (tab === 'chat') setSeenChat(chatLen)
  }, [tab, chatLen])
  const unread = Math.max(0, chatLen - seenChat)

  return (
    <div className="game">
      <header className="topbar">
        <span className="brand">風聲</span>
        <span className="turn">第 {v.turnNo} 回合．{v.players[v.active].name}</span>
        {social && <VoiceControls voice={social.voice} speakers={social.room.voice.length} />}
        {topExtra}
        <span className="deck">牌庫 {v.deckCount}．棄牌 {v.discardCount}</span>
        <button type="button" className="ghost" onClick={onExit}>
          {exitLabel}
        </button>
      </header>

      <div className="layout">
        <section className="desk" aria-label="牌桌">
          <div className="ring">
            {v.players.map((p, i) => (
              <Seat
                key={p.seat}
                p={p}
                me={p.seat === v.me}
                active={p.seat === v.active}
                holding={!!v.trans && v.trans.stage !== 'A' && v.trans.holder === p.seat}
                locked={v.locks.includes(p.seat)}
                diverted={v.diverts.includes(p.seat)}
                waiting={ctl.waitingOn.includes(p.seat) && p.seat !== v.me}
                winner={!!v.result?.winners.includes(p.seat)}
                aiControlled={ctl.aiControlled.includes(p.seat)}
                style={{ left: pos[i].left, top: pos[i].top }}
              />
            ))}
            <Centre v={v} />
          </div>
        </section>

        <aside className="side">
          <div className="me-card">
            <div className="me-row">
              {me.faction && <FactionBadge faction={me.faction} />}
              <b>{myChar?.name ?? '—'}</b>
              {myChar && !me.charFaceUp && <span className="muted">蓋伏中</span>}
            </div>
            {myChar && (
              <p className="me-mission">
                {me.faction === 'neutral' ? '你的勝利條件：' : '機密任務（打醬油時才生效）：'}
                {myChar.missionText}
              </p>
            )}
            {me.faction && me.faction !== 'neutral' && (
              <p className="me-mission">
                你的勝利條件：你或隊友集滿三張{me.faction === 'red' ? '紅色' : '藍色'}情報。
              </p>
            )}
          </div>
          {social && (
            <div className="tabs" role="tablist">
              <button type="button" role="tab" aria-selected={tab === 'log'} className={tab === 'log' ? 'on' : ''} onClick={() => setTab('log')}>
                遊戲紀錄
              </button>
              <button type="button" role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
                聊天{unread > 0 && <span className="badge">{unread}</span>}
              </button>
            </div>
          )}
          {social && tab === 'chat' ? <ChatPanel chat={social.chat} me={social.me} say={social.say} /> : <Log v={v} />}
        </aside>
      </div>

      <section className="bench" aria-label="你的手牌與行動">
        <Prompt v={v} ctl={ctl} skip={skip} selCard={selCard} legal={selCard ? legalById.get(selCard.id) ?? null : null} clear={() => setSel(null)} />
        <div className="hand" role="group" aria-label="手牌">
          {v.hand.length === 0 && <span className="muted">沒有手牌</span>}
          {v.hand.map((c) => (
            <CardFace
              key={c.id}
              card={c}
              selected={sel === c.id}
              usable={legalById.has(c.id) || d?.type === 'play' || d?.type === 'discard'}
              onClick={() => setSel(sel === c.id ? null : c.id)}
            />
          ))}
        </div>
      </section>

      {ctl.error && (
        <div className="toast" role="alert" onClick={ctl.clearError}>
          {ctl.error}
        </div>
      )}
      {v.result && <Result v={v} actions={resultActions} />}
    </div>
  )
}

function Centre({ v }: { v: GameView }) {
  const t = v.trans
  const name = (p: number) => v.players[p].name
  return (
    <div className="centre">
      {t ? (
        <div className={`envelope m-${t.method}`}>
          <span className="env-seal">{SEAL[t.method]}</span>
          <div className="env-body">
            <span className="env-title">
              {METHOD_NAME[t.method]}情報
              {t.method !== 'direct' && <span className="env-dir">{t.dir === 1 ? '順向' : '逆向'}傳遞</span>}
            </span>
            <span className="env-route">
              {name(t.sender)} 傳出
              {t.target != null && `，直達 ${name(t.target)}`}
            </span>
            <span className="env-where">
              {t.stage === 'A' ? `即將傳給 ${name(t.next)}` : `目前在 ${name(t.holder)} 面前`}
            </span>
          </div>
          <div className="env-card">{t.card ? <CardFace card={t.card} small /> : <span className="env-hidden">內容未知</span>}</div>
        </div>
      ) : (
        <div className="envelope is-idle">
          <span className="env-seal">候</span>
          <div className="env-body">
            <span className="env-title">等待 {name(v.active)} 傳出情報</span>
            <span className="env-route">出牌階段可先使用功能牌</span>
          </div>
        </div>
      )}
      {v.stack.length > 0 && (
        <ol className="stack" aria-label="結算中的卡牌（後發先至）">
          {v.stack.map((s) => (
            <li key={s.uid} className={s.countered ? 'is-countered' : ''}>
              <b>{name(s.user)}</b>【{KIND_NAME[s.kind]}】
              {s.target != null && s.kind !== 'counter' && <> → {name(s.target)}</>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

function describe(v: GameView): string {
  const d = v.decision
  const name = (p: number) => v.players[p].name
  const t = v.trans
  if (!d) {
    if (v.result) return '遊戲結束'
    return '等待其他玩家…'
  }
  switch (d.type) {
    case 'play':
      return '你的出牌階段：可以先使用功能牌，最後必須傳出一張情報。點選一張手牌。'
    case 'accept':
      return t?.card ? `要接收這份情報（${t.card.colour === 'black' ? '假情報' : `${COLOUR_NAME[t.card.colour]}色情報`}）嗎？` : '情報傳到你面前，要接收嗎？你不知道內容。'
    case 'discard':
      return '你被試探猜中了，要棄一張牌。點選一張手牌棄掉（暗棄）。'
    case 'chaos_pick':
      return '真偽莫辨：選一張蓋著的牌作為你的情報。'
    case 'choose_character':
      return '挑選角色'
    case 'priority': {
      if (d.ctx === 'resp') {
        const top = v.stack[v.stack.length - 1]
        return `${name(top.user)} 使用了【${KIND_NAME[top.kind]}】${top.target != null && top.kind !== 'counter' ? `（目標 ${name(top.target)}）` : ''}。要用識破回應嗎？`
      }
      if (d.ctx === 'hopA') return `情報即將傳給 ${t ? name(t.next) : '—'}。要使用卡牌嗎？`
      if (d.ctx === 'hopB')
        return t?.holder === v.me ? '情報傳到你面前。可以先破譯或退回。' : `情報在 ${t ? name(t.holder) : '—'} 面前。要使用卡牌嗎？`
      return '要使用卡牌嗎？'
    }
  }
}

function Prompt({
  v,
  ctl,
  skip,
  selCard,
  legal,
  clear,
}: {
  v: GameView
  ctl: GameController
  skip: Skip
  selCard: Card | null
  legal: LegalPlay | null
  clear: () => void
}) {
  const d = v.decision
  const left = useSecondsLeft(d ? ctl.deadline : null)
  const act = (a: Action) => {
    ctl.act(a)
    clear()
  }
  const name = (p: number) => v.players[p].name
  const others = v.players.filter((p) => p.status === 'alive' && p.seat !== v.me)
  const mine = d && d.player === v.me

  return (
    <div className={`prompt ${mine ? 'is-mine' : ''}`}>
      <p className="prompt-text">
        {describe(v)}
        {left != null && <span className={`countdown ${left <= 5 ? 'is-urgent' : ''}`}>剩 {left} 秒</span>}
      </p>

      {d?.type === 'chaos_pick' && (
        <div className="choices">
          {d.slots.map((s) => (
            <button key={s} type="button" className="facedown" onClick={() => act({ type: 'chaos_pick', slot: s })}>
              第 {s + 1} 張
            </button>
          ))}
        </div>
      )}

      {d?.type === 'accept' && (
        <div className="choices">
          <button type="button" className="primary" onClick={() => act({ type: 'accept' })}>
            接收情報
          </button>
          <button type="button" onClick={() => act({ type: 'decline' })}>
            不接收
          </button>
        </div>
      )}

      {d?.type === 'discard' && selCard && (
        <div className="choices">
          <button type="button" className="primary" onClick={() => act({ type: 'discard', card: selCard.id })}>
            棄掉【{KIND_NAME[selCard.kind]}】
          </button>
        </div>
      )}

      {(d?.type === 'play' || d?.type === 'priority') && selCard && (
        <div className="selected">
          <p className="sel-desc">
            <b>【{KIND_NAME[selCard.kind]}】</b>
            {KIND_DESC[selCard.kind]}
          </p>
          <div className="choices">
            {legal && <PlayOptions legal={legal} v={v} onPlay={act} />}
            {!legal && d.type === 'priority' && <span className="muted">這張牌現在不能使用。</span>}
            {d.type === 'play' &&
              (selCard.method === 'direct' ? (
                <span className="choice-group">
                  <span className="choice-label">直達傳給</span>
                  {others.map((p) => (
                    <button key={p.seat} type="button" className="primary" onClick={() => act({ type: 'send', card: selCard.id, target: p.seat })}>
                      {p.name}
                    </button>
                  ))}
                </span>
              ) : (
                <button type="button" className="primary" onClick={() => act({ type: 'send', card: selCard.id })}>
                  以{METHOD_NAME[selCard.method]}傳出這張情報
                </button>
              ))}
          </div>
        </div>
      )}

      {d?.type === 'priority' && (
        <div className="choices">
          <button type="button" onClick={() => act({ type: 'pass' })}>
            不使用
          </button>
          {skip.skipping ? (
            <button type="button" className="ghost" onClick={skip.stop}>
              恢復詢問
            </button>
          ) : (
            <button type="button" className="ghost" onClick={skip.skip} title="這個回合中與你無關的時機自動略過">
              本回合都略過
            </button>
          )}
        </div>
      )}

      {!mine && v.decision == null && !v.result && v.trans && (
        <p className="muted">{v.trans.stage === 'decide' ? `${name(v.trans.holder)} 正在決定是否接收…` : ''}</p>
      )}
    </div>
  )
}

function PlayOptions({ legal, v, onPlay }: { legal: LegalPlay; v: GameView; onPlay: (a: Action) => void }) {
  const name = (p: number) => v.players[p].name
  const label = `使用【${KIND_NAME[legal.kind]}】`
  if (legal.kind === 'counter' && legal.refs) {
    const r = legal.refs[0]
    return (
      <button type="button" className="primary" onClick={() => onPlay({ type: 'play_card', card: legal.card, target: r.target, targetRef: r.ref })}>
        {label}識破 {name(r.target)}
      </button>
    )
  }
  if (legal.refs) {
    return (
      <span className="choice-group">
        <span className="choice-label">{label}</span>
        {legal.refs.map((r) => {
          const c = v.players[r.target].intel.find((x) => x.id === r.ref)
          return (
            <button key={r.ref} type="button" className="primary" onClick={() => onPlay({ type: 'play_card', card: legal.card, target: r.target, targetRef: r.ref })}>
              {name(r.target)} 的 {c && <IntelChip card={c} />}
            </button>
          )
        })}
      </span>
    )
  }
  if (legal.targets) {
    return (
      <span className="choice-group">
        <span className="choice-label">{label}，目標</span>
        {legal.targets.map((t) => (
          <button key={t} type="button" className="primary" onClick={() => onPlay({ type: 'play_card', card: legal.card, target: t })}>
            {t === v.me ? '自己' : name(t)}
          </button>
        ))}
      </span>
    )
  }
  return (
    <button type="button" className="primary" onClick={() => onPlay({ type: 'play_card', card: legal.card })}>
      {label}
    </button>
  )
}

function Log({ v }: { v: GameView }) {
  const ref = useRef<HTMLOListElement>(null)
  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [v.log.length])
  return (
    <ol className="log" ref={ref} aria-label="遊戲紀錄" aria-live="polite">
      {v.log.map((l) => (
        <li
          key={l.seq}
          className={[l.vis ? 'is-private' : '', l.text.startsWith('──') ? 'is-turn' : '', l.text.startsWith('★') ? 'is-end' : '']
            .filter(Boolean)
            .join(' ')}
        >
          {l.vis && <span className="priv">僅你可見</span>}
          {l.text}
        </li>
      ))}
    </ol>
  )
}

function Result({ v, actions }: { v: GameView; actions: ReactNode }) {
  const r = v.result!
  const won = r.winners.includes(v.me)
  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="遊戲結果">
      <div className="result">
        <h2>{r.winners.length === 0 ? '平手' : won ? '你贏了' : '你輸了'}</h2>
        <p>{r.reason}</p>
        <table>
          <tbody>
            {v.players.map((p) => (
              <tr key={p.seat} className={r.winners.includes(p.seat) ? 'is-win' : ''}>
                <td>{p.name}</td>
                <td>{p.faction ? FACTION_NAME[p.faction] : ''}</td>
                <td>{p.character ? CHAR_BY_ID[p.character].name : ''}</td>
                <td>{r.winners.includes(p.seat) ? '勝利' : p.status === 'alive' ? '' : p.status === 'dead' ? '死亡' : '出局'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="result-actions">{actions}</div>
      </div>
    </div>
  )
}
