import Peer, { type DataConnection } from 'peerjs'
import { FACTION_SETUPS } from '../engine/data'
import type { Action, GameConfig, GameState } from '../engine/types'
import { viewFor } from '../engine/view'
import {
  clientId,
  makeCode,
  PEER_PREFIX,
  peerOptions,
  type ChatMsg,
  type GamePacket,
  type Member,
  type RoomInfo,
  type RoomSettings,
  type ToGuest,
  type ToHost,
} from './protocol'
import { GameRunner, ONLINE_TIMEOUTS } from './runner'

const SAVE_KEY = 'fs-host-room'
const GRACE_MS = 15_000
const AI_NAMES = ['顧曉夢', '李寧玉', '吳志國', '白小年', '金生火', '王田香', '老周', '小方', '龍川']

interface Saved {
  code: string
  name: string
  members: Member[]
  settings: RoomSettings
  started: boolean
  config: GameConfig | null
  state: GameState | null
  chat: ChatMsg[]
  savedAt: number
}

export function savedHostRoom(): Saved | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as Saved
    // 超過 6 小時就不提供恢復
    if (Date.now() - s.savedAt > 6 * 3600_000) return null
    return s
  } catch {
    return null
  }
}

export function clearSavedHostRoom() {
  try {
    localStorage.removeItem(SAVE_KEY)
  } catch {
    /* ignore */
  }
}

/**
 * 房主：持有權威遊戲狀態，透過 PeerJS 接受玩家連線。
 * 每位玩家只會收到 viewFor(自己座位) 的資料。
 */
export class HostSession {
  peer!: Peer
  code: string
  readonly me = clientId()
  name: string
  members: Member[]
  settings: RoomSettings = { count: 5, setupIdx: 0, alliance: false }
  started = false
  runner: GameRunner | null = null
  config: GameConfig | null = null
  chat: ChatMsg[] = []
  voice = new Map<string, string>()
  status: 'opening' | 'open' | 'error' = 'opening'
  error: string | null = null
  version = 0
  private conns = new Map<string, DataConnection>()
  private subs = new Set<() => void>()
  private grace = new Map<string, ReturnType<typeof setTimeout>>()
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private closed = false

  constructor(name: string, saved?: Saved) {
    this.name = name
    this.code = saved?.code ?? makeCode()
    this.members = [{ clientId: this.me, name, connected: true, isHost: true, seat: null }]
    if (saved) this.restore(saved)
  }

  subscribe = (fn: () => void) => {
    this.subs.add(fn)
    return () => {
      this.subs.delete(fn)
    }
  }

  private emit() {
    this.version++
    for (const fn of this.subs) fn()
  }

  // ───────── 連線 ─────────

  async open(): Promise<void> {
    const restoring = this.started || this.members.length > 1
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        await this.tryOpen()
        this.status = 'open'
        this.emit()
        return
      } catch (e) {
        const type = (e as { type?: string }).type
        if (type === 'unavailable-id') {
          // 恢復房間時，舊的連線可能還沒被配對伺服器釋放，稍等再試同一個代碼
          if (restoring) await new Promise((r) => setTimeout(r, 2500))
          else this.code = makeCode()
          continue
        }
        this.status = 'error'
        this.error = describePeerError(type)
        this.emit()
        throw e
      }
    }
    this.status = 'error'
    this.error = '無法建立房間代碼，請稍後再試'
    this.emit()
  }

  private tryOpen(): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer(PEER_PREFIX + this.code, peerOptions())
      const onErr = (e: unknown) => {
        peer.destroy()
        reject(e)
      }
      peer.once('error', onErr)
      peer.once('open', () => {
        peer.off('error', onErr)
        this.peer = peer
        peer.on('connection', (c) => this.onConn(c))
        peer.on('disconnected', () => {
          if (!this.closed) peer.reconnect()
        })
        peer.on('error', (e) => console.warn('peer error', e))
        resolve()
      })
    })
  }

  private onConn(conn: DataConnection) {
    conn.on('data', (raw) => this.onData(conn, raw as ToHost))
    conn.on('close', () => this.onClose(conn))
    conn.on('error', () => this.onClose(conn))
  }

  private send(conn: DataConnection | undefined, msg: ToGuest) {
    if (conn?.open) conn.send(msg)
  }

  private memberOf(conn: DataConnection) {
    for (const [id, c] of this.conns) if (c === conn) return this.members.find((m) => m.clientId === id) ?? null
    return null
  }

  private onData(conn: DataConnection, msg: ToHost) {
    if (!msg || typeof msg !== 'object') return
    if (msg.t === 'hello') return this.onHello(conn, msg.clientId, String(msg.name ?? '').slice(0, 12) || '玩家')
    const m = this.memberOf(conn)
    if (!m) return
    switch (msg.t) {
      case 'action': {
        if (!this.runner || m.seat == null) return
        const err = this.runner.submit(m.seat, msg.action)
        if (err) this.send(conn, { t: 'error', msg: err })
        break
      }
      case 'chat':
        this.addChat(m, String(msg.text ?? ''))
        break
      case 'voice':
        if (msg.peerId) this.voice.set(m.clientId, String(msg.peerId))
        else this.voice.delete(m.clientId)
        this.broadcastRoom()
        break
    }
  }

  private onHello(conn: DataConnection, cid: string, name: string) {
    let m = this.members.find((x) => x.clientId === cid)
    if (m && !m.isHost) {
      const old = this.conns.get(cid)
      if (old && old !== conn) old.close()
      m.connected = true
      this.conns.set(cid, conn)
      clearTimeout(this.grace.get(cid))
      if (this.runner && m.seat != null) this.runner.setHuman(m.seat, true)
      this.system(`${m.name} 重新連線。`)
    } else {
      if (this.started) return this.send(conn, { t: 'rejected', reason: '這局已經開始了，等下一局再加入。' })
      if (this.members.length >= 9) return this.send(conn, { t: 'rejected', reason: '房間已滿（最多 9 人）。' })
      let nm = name
      for (let i = 2; this.members.some((x) => x.name === nm); i++) nm = `${name}${i}`
      m = { clientId: cid, name: nm, connected: true, isHost: false, seat: null }
      this.members.push(m)
      this.conns.set(cid, conn)
      if (this.settings.count < this.members.length) this.settings = { ...this.settings, count: this.members.length, setupIdx: 0 }
      this.system(`${nm} 加入房間。`)
    }
    this.send(conn, { t: 'chat', msgs: this.chat.slice(-100), replace: true })
    this.broadcastRoom()
    this.pushGame()
  }

  private onClose(conn: DataConnection) {
    const m = this.memberOf(conn)
    if (!m || this.conns.get(m.clientId) !== conn) return
    this.conns.delete(m.clientId)
    m.connected = false
    this.voice.delete(m.clientId)
    if (!this.started) {
      this.members = this.members.filter((x) => x !== m)
      this.system(`${m.name} 離開房間。`)
    } else if (m.seat != null) {
      const seat = m.seat
      this.system(`${m.name} 斷線了，${GRACE_MS / 1000} 秒內沒回來會由 AI 代打。`)
      this.grace.set(
        m.clientId,
        setTimeout(() => {
          if (!m.connected && this.runner) {
            this.runner.setHuman(seat, false)
            this.system(`${m.name} 由 AI 代打中。`)
          }
        }, GRACE_MS),
      )
    }
    this.broadcastRoom()
  }

  // ───────── 房間 ─────────

  roomInfo(): RoomInfo {
    return {
      code: this.code,
      members: this.members.map((m) => ({ ...m })),
      settings: { ...this.settings },
      started: this.started,
      voice: [...this.voice].map(([cid, peerId]) => ({ clientId: cid, peerId })),
    }
  }

  private broadcastRoom() {
    const room = this.roomInfo()
    for (const c of this.conns.values()) this.send(c, { t: 'room', room })
    this.persist()
    this.emit()
  }

  updateSettings(p: Partial<RoomSettings>) {
    if (this.started) return
    const next = { ...this.settings, ...p }
    next.count = Math.max(3, Math.min(9, Math.max(next.count, this.members.length)))
    if (next.setupIdx >= FACTION_SETUPS[next.count].length) next.setupIdx = 0
    if (FACTION_SETUPS[next.count][next.setupIdx][2] < 2) next.alliance = false
    this.settings = next
    this.broadcastRoom()
  }

  private system(text: string) {
    this.pushChat({ id: Date.now() + Math.random(), clientId: null, name: '系統', text, ts: Date.now(), system: true })
  }

  private addChat(m: Member, text: string) {
    const t = text.trim().slice(0, 300)
    if (!t) return
    this.pushChat({ id: Date.now() + Math.random(), clientId: m.clientId, name: m.name, text: t, ts: Date.now() })
  }

  private pushChat(msg: ChatMsg) {
    this.chat.push(msg)
    if (this.chat.length > 300) this.chat = this.chat.slice(-200)
    for (const c of this.conns.values()) this.send(c, { t: 'chat', msgs: [msg] })
    this.persist()
    this.emit()
  }

  say(text: string) {
    this.addChat(this.members[0], text)
  }

  setVoice(peerId: string | null) {
    if (peerId) this.voice.set(this.me, peerId)
    else this.voice.delete(this.me)
    this.broadcastRoom()
  }

  // ───────── 遊戲 ─────────

  start() {
    if (this.started) return
    const n = Math.max(this.settings.count, this.members.length)
    const setups = FACTION_SETUPS[n]
    const factions = setups[Math.min(this.settings.setupIdx, setups.length - 1)]
    const humans = this.members.slice(0, n)
    humans.forEach((m, i) => (m.seat = i))
    const used = new Set(humans.map((m) => m.name))
    const aiNames = AI_NAMES.filter((x) => !used.has(x)).sort(() => Math.random() - 0.5)
    const config: GameConfig = {
      players: [
        ...humans.map((m) => ({ id: m.clientId, name: m.name, isAI: false })),
        ...Array.from({ length: n - humans.length }, (_, i) => ({ id: `ai${i}`, name: `${aiNames[i] ?? `電腦${i + 1}`}`, isAI: true })),
      ],
      factions,
      neutralAlliance: this.settings.alliance && factions[2] >= 2,
      seed: (Math.random() * 2 ** 31) | 0,
    }
    this.config = config
    this.startRunner(
      config,
      humans.map((m) => m.seat!),
    )
    this.system(`遊戲開始！${n} 人局，${n - humans.length} 位電腦補位。`)
  }

  private startRunner(config: GameConfig, humanSeats: number[], state?: GameState) {
    this.runner?.dispose()
    this.runner = new GameRunner(config, humanSeats, { aiDelay: 700, timeouts: ONLINE_TIMEOUTS }, state)
    this.runner.subscribe(() => this.pushGame())
    this.started = true
    this.broadcastRoom()
    this.pushGame()
  }

  packetFor(seat: number): GamePacket | null {
    const r = this.runner
    if (!r) return null
    return {
      view: viewFor(r.state, seat),
      waitingOn: r.waitingOn(),
      deadline: r.deadline,
      aiControlled: this.members.filter((m) => m.seat != null && !r.isHuman(m.seat)).map((m) => m.seat!),
    }
  }

  get hostSeat() {
    return this.members[0].seat
  }

  hostAct(a: Action): string | null {
    if (!this.runner || this.hostSeat == null) return '遊戲尚未開始'
    return this.runner.submit(this.hostSeat, a)
  }

  private pushGame() {
    for (const m of this.members) {
      if (m.isHost) continue
      const c = this.conns.get(m.clientId)
      this.send(c, { t: 'game', game: m.seat != null ? this.packetFor(m.seat) : null })
    }
    this.persist()
    this.emit()
  }

  /** 一局結束後回到房間 */
  backToRoom() {
    this.runner?.dispose()
    this.runner = null
    this.config = null
    this.started = false
    for (const t of this.grace.values()) clearTimeout(t)
    this.members = this.members.filter((m) => m.isHost || m.connected)
    this.members.forEach((m) => (m.seat = null))
    this.broadcastRoom()
    this.pushGame()
  }

  close() {
    this.closed = true
    for (const c of this.conns.values()) this.send(c, { t: 'rejected', reason: '房主關閉了房間。' })
    setTimeout(() => this.peer?.destroy(), 300)
    this.runner?.dispose()
    clearTimeout(this.saveTimer)
    clearSavedHostRoom()
  }

  // ───────── 存檔（房主重新整理也能恢復）─────────

  private persist() {
    if (this.closed) return
    clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      const s: Saved = {
        code: this.code,
        name: this.name,
        members: this.members,
        settings: this.settings,
        started: this.started,
        config: this.config,
        state: this.runner?.state ?? null,
        chat: this.chat.slice(-100),
        savedAt: Date.now(),
      }
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(s))
      } catch {
        /* 空間不足時放棄存檔 */
      }
    }, 800)
  }

  private restore(s: Saved) {
    this.settings = s.settings
    this.chat = s.chat ?? []
    this.members = s.members.map((m) => ({ ...m, connected: m.clientId === this.me }))
    const host = this.members.find((m) => m.clientId === this.me)
    if (host) host.isHost = true
    if (s.started && s.config && s.state && !s.state.result) {
      this.config = s.config
      const seats = this.members.filter((m) => m.seat != null).map((m) => m.seat!)
      // 先當作大家都還在，給他們時間重連
      this.startRunner(s.config, seats, s.state)
      for (const m of this.members) {
        if (m.isHost || m.seat == null) continue
        const seat = m.seat
        this.grace.set(
          m.clientId,
          setTimeout(() => {
            if (!m.connected) this.runner?.setHuman(seat, false)
          }, 30_000),
        )
      }
    } else {
      this.members = this.members.filter((m) => m.isHost)
      this.members.forEach((m) => (m.seat = null))
    }
  }
}

export function describePeerError(type?: string): string {
  switch (type) {
    case 'browser-incompatible':
      return '這個瀏覽器不支援 P2P 連線，請改用 Chrome、Edge、Firefox 或 Safari 最新版。'
    case 'network':
    case 'server-error':
    case 'socket-error':
    case 'socket-closed':
      return '連不到配對伺服器，請檢查網路後再試。'
    case 'peer-unavailable':
      return '找不到這個房間，請確認邀請碼，或房主是否還開著網頁。'
    case 'webrtc':
      return '無法建立 P2P 連線，可能是網路環境（例如宿舍或公司網路）擋住了。'
    default:
      return `連線發生錯誤（${type ?? '未知'}）`
  }
}
