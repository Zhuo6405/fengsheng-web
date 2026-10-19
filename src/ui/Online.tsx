import { useEffect, useMemo, useState } from 'react'
import { FACTION_SETUPS } from '../engine/data'
import type { GuestSession } from '../net/guest'
import type { HostSession } from '../net/host'
import type { ChatMsg, RoomInfo, RoomSettings } from '../net/protocol'
import { VoiceMesh } from '../net/voice'
import { useStore, type GameController, type Social } from './controller'
import { GameScreen } from './Game'
import { ChatPanel, VoiceControls } from './social'

function useVoice(peer: unknown, ready: boolean, report: (id: string | null) => void, roster: string[]) {
  const [voice, setVoice] = useState<VoiceMesh | null>(null)
  useEffect(() => {
    if (!ready || !peer) return
    const v = new VoiceMesh(peer as ConstructorParameters<typeof VoiceMesh>[0], report)
    setVoice(v)
    return () => v.dispose()
    // report 是穩定的 session 方法，只在連線建立時建立一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, peer])
  const key = roster.join(',')
  useEffect(() => {
    voice?.sync(roster)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice, key])
  return voice
}

export function inviteLink(code: string) {
  const u = new URL(location.href)
  u.searchParams.set('room', code)
  return u.toString()
}

// ───────────────────────── 房主 ─────────────────────────

export function HostScreen({ session, onExit }: { session: HostSession; onExit: () => void }) {
  const version = useStore(session)
  const [error, setError] = useState<string | null>(null)
  const room = session.roomInfo()
  const voice = useVoice(
    session.status === 'open' ? session.peer : null,
    session.status === 'open',
    (id) => session.setVoice(id),
    room.voice.map((x) => x.peerId),
  )
  const seat = session.hostSeat
  const packet = useMemo(
    () => (session.started && seat != null ? session.packetFor(seat) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [version, seat],
  )
  const leave = () => {
    if (session.status === 'open' && !confirm('關閉房間後所有人都會斷線，確定嗎？')) return
    session.close()
    onExit()
  }

  if (session.status === 'opening') return <Centered text="正在建立房間…" />
  if (session.status === 'error') return <Centered text={session.error ?? '建立房間失敗'} action={onExit} actionLabel="回到大廳" />

  const social: Social = { me: session.me, room, chat: session.chat, say: (t) => session.say(t), voice }
  if (packet) {
    const ctl: GameController = {
      view: packet.view,
      act: (a) => setError(session.hostAct(a)),
      error,
      clearError: () => setError(null),
      waitingOn: packet.waitingOn,
      deadline: packet.deadline,
      aiControlled: packet.aiControlled,
    }
    return (
      <GameScreen
        ctl={ctl}
        social={social}
        onExit={leave}
        exitLabel="關閉房間"
        historyId={`online-${room.code}-${session.config?.seed}`}
        topExtra={<span className="room-code">房號 {room.code}</span>}
        resultActions={
          <>
            <button type="button" className="primary" onClick={() => session.backToRoom()}>
              回到房間再來一局
            </button>
            <button type="button" onClick={leave}>
              關閉房間
            </button>
          </>
        }
      />
    )
  }
  return (
    <RoomView
      room={room}
      me={session.me}
      isHost
      chat={session.chat}
      say={(t) => session.say(t)}
      voice={voice}
      onSettings={(p) => session.updateSettings(p)}
      onStart={() => session.start()}
      onLeave={leave}
    />
  )
}

// ───────────────────────── 玩家 ─────────────────────────

export function GuestScreen({ session, onExit }: { session: GuestSession; onExit: () => void }) {
  useStore(session)
  const ready = session.status === 'open' || session.status === 'reconnecting'
  const voice = useVoice(
    session.peer,
    ready,
    (id) => session.setVoice(id),
    (session.room?.voice ?? []).map((x) => x.peerId),
  )
  const leave = () => {
    session.leave()
    onExit()
  }

  if (session.status === 'closed') return <Centered text={session.error ?? '連線已結束'} action={onExit} actionLabel="回到大廳" />
  if (!session.room) return <Centered text={`正在連線到房間 ${session.code}…`} action={leave} actionLabel="取消" />

  const room = session.room
  const banner = session.status === 'reconnecting' && <div className="banner">和房主的連線中斷，正在重新連線…</div>
  const social: Social = { me: session.me, room, chat: session.chat, say: (t) => session.say(t), voice }
  const g = session.game
  if (g && room.started) {
    const ctl: GameController = {
      view: g.view,
      act: (a) => session.act(a),
      error: session.lastError,
      clearError: () => session.clearError(),
      waitingOn: g.waitingOn,
      deadline: g.deadline,
      aiControlled: g.aiControlled,
    }
    return (
      <>
        {banner}
        <GameScreen
          ctl={ctl}
          social={social}
          onExit={leave}
          exitLabel="離開房間"
          historyId={`online-${room.code}-${g.view.players.map((p) => p.name).join('')}-${g.view.turnNo}`}
          topExtra={<span className="room-code">房號 {room.code}</span>}
          resultActions={
            <>
              <span className="muted">等房主開新的一局…</span>
              <button type="button" onClick={leave}>
                離開房間
              </button>
            </>
          }
        />
      </>
    )
  }
  return (
    <>
      {banner}
      <RoomView room={room} me={session.me} isHost={false} chat={session.chat} say={(t) => session.say(t)} voice={voice} onLeave={leave} />
    </>
  )
}

// ───────────────────────── 房間畫面 ─────────────────────────

function RoomView({
  room,
  me,
  isHost,
  chat,
  say,
  voice,
  onSettings,
  onStart,
  onLeave,
}: {
  room: RoomInfo
  me: string
  isHost: boolean
  chat: ChatMsg[]
  say: (t: string) => void
  voice: VoiceMesh | null
  onSettings?: (p: Partial<RoomSettings>) => void
  onStart?: () => void
  onLeave: () => void
}) {
  const [copied, setCopied] = useState(false)
  const s = room.settings
  const setups = FACTION_SETUPS[s.count]
  const setup = setups[Math.min(s.setupIdx, setups.length - 1)]
  const humans = room.members.length
  const ai = Math.max(0, s.count - humans)
  const inVoice = new Set(room.voice.map((x) => x.clientId))
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(inviteLink(room.code))
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      prompt('複製這個連結傳給朋友：', inviteLink(room.code))
    }
  }

  return (
    <div className="room">
      <header className="topbar">
        <span className="brand">風聲</span>
        <span className="turn">房間</span>
        <VoiceControls voice={voice} speakers={room.voice.length} />
        <button type="button" className="ghost" onClick={onLeave}>
          {isHost ? '關閉房間' : '離開房間'}
        </button>
      </header>

      <div className="room-body">
        <section className="room-main">
          <div className="invite">
            <span className="invite-label">邀請碼</span>
            <span className="invite-code" aria-label={`邀請碼 ${room.code.split('').join(' ')}`}>
              {room.code}
            </span>
            <button type="button" className="primary" onClick={() => void copy()}>
              {copied ? '已複製連結' : '複製邀請連結'}
            </button>
            <p className="muted">朋友打開連結、輸入名字就能加入。也可以在首頁輸入邀請碼。</p>
          </div>

          <h2>玩家（{humans} / {s.count}）</h2>
          <ul className="members">
            {room.members.map((m) => (
              <li key={m.clientId} className={m.connected ? '' : 'is-off'}>
                <span className="m-name">
                  {m.name}
                  {m.clientId === me && <span className="seat-you">你</span>}
                </span>
                {m.isHost && <span className="tag">房主</span>}
                {inVoice.has(m.clientId) && <span className="tag tag-voice">語音中</span>}
                {!m.connected && <span className="tag">斷線</span>}
              </li>
            ))}
            {Array.from({ length: ai }, (_, i) => (
              <li key={`ai${i}`} className="is-ai">
                <span className="m-name">電腦補位</span>
              </li>
            ))}
          </ul>

          <h2>設定</h2>
          {isHost && onSettings ? (
            <div className="room-settings">
              <div className="field">
                <span>遊戲人數（人不夠會由電腦補位）</span>
                <div className="segmented" role="radiogroup" aria-label="遊戲人數">
                  {[3, 4, 5, 6, 7, 8, 9].map((n) => (
                    <button
                      key={n}
                      type="button"
                      role="radio"
                      aria-checked={n === s.count}
                      className={n === s.count ? 'on' : ''}
                      disabled={n < humans}
                      onClick={() => onSettings({ count: n, setupIdx: 0 })}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <span>陣營配置</span>
                <div className="setups">
                  {setups.map((x, i) => (
                    <button key={i} type="button" className={`setup ${x === setup ? 'on' : ''}`} aria-pressed={x === setup} onClick={() => onSettings({ setupIdx: i })}>
                      <b className="f-red">潛伏 {x[0]}</b>
                      <b className="f-blue">軍情 {x[1]}</b>
                      <b className="f-neutral">特工 {x[2]}</b>
                    </button>
                  ))}
                </div>
              </div>
              <label className={`check ${setup[2] < 2 ? 'is-disabled' : ''}`}>
                <input type="checkbox" checked={s.alliance} disabled={setup[2] < 2} onChange={(e) => onSettings({ alliance: e.target.checked })} />
                <span>
                  特工同盟
                  <small>一位特工宣告勝利時，所有特工一同勝利。</small>
                </span>
              </label>
              <button type="button" className="primary start" onClick={onStart}>
                開始遊戲{ai > 0 ? `（${ai} 位電腦補位）` : ''}
              </button>
            </div>
          ) : (
            <p className="room-readonly">
              {s.count} 人局．潛伏 {setup[0]}、軍情 {setup[1]}、特工 {setup[2]}
              {s.alliance ? '．特工同盟' : ''}
              <br />
              <span className="muted">等房主開始遊戲…</span>
            </p>
          )}
        </section>

        <aside className="room-chat">
          <h2>聊天</h2>
          <ChatPanel chat={chat} me={me} say={say} />
        </aside>
      </div>
    </div>
  )
}

function Centered({ text, action, actionLabel }: { text: string; action?: () => void; actionLabel?: string }) {
  return (
    <main className="centered">
      <p>{text}</p>
      {action && (
        <button type="button" onClick={action}>
          {actionLabel}
        </button>
      )}
    </main>
  )
}
