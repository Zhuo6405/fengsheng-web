import Peer, { type DataConnection } from 'peerjs'
import type { Action } from '../engine/types'
import { describePeerError } from './host'
import { clientId, PEER_PREFIX, peerOptions, type ChatMsg, type GamePacket, type RoomInfo, type ToGuest, type ToHost } from './protocol'

const GIVE_UP_MS = 120_000

/** 一般玩家：連到房主，收到的只有自己看得到的資訊 */
export class GuestSession {
  peer!: Peer
  conn: DataConnection | null = null
  readonly me = clientId()
  room: RoomInfo | null = null
  game: GamePacket | null = null
  chat: ChatMsg[] = []
  status: 'connecting' | 'open' | 'reconnecting' | 'closed' = 'connecting'
  error: string | null = null
  lastError: string | null = null
  version = 0
  private subs = new Set<() => void>()
  private retry: ReturnType<typeof setTimeout> | undefined
  private lostAt: number | null = null
  private everOpen = false
  private left = false

  code: string
  name: string

  constructor(code: string, name: string) {
    this.code = code
    this.name = name
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

  connect() {
    this.peer = new Peer(peerOptions())
    this.peer.on('open', () => this.dial())
    this.peer.on('disconnected', () => {
      if (!this.left) this.peer.reconnect()
    })
    this.peer.on('error', (e) => {
      const type = (e as { type?: string }).type
      if (type === 'peer-unavailable') {
        if (!this.everOpen) return this.fail(describePeerError(type))
        return this.lost()
      }
      if (!this.everOpen && type !== 'disconnected') this.fail(describePeerError(type))
    })
  }

  private dial() {
    if (this.left) return
    const conn = this.peer.connect(PEER_PREFIX + this.code, { reliable: true })
    this.conn = conn
    conn.on('open', () => {
      this.everOpen = true
      this.lostAt = null
      this.status = 'open'
      this.error = null
      this.send({ t: 'hello', clientId: this.me, name: this.name })
      this.emit()
    })
    conn.on('data', (raw) => this.onData(raw as ToGuest))
    conn.on('close', () => {
      if (this.conn === conn) this.lost()
    })
  }

  private lost() {
    if (this.left || this.status === 'closed') return
    this.status = 'reconnecting'
    this.lostAt ??= Date.now()
    if (Date.now() - this.lostAt > GIVE_UP_MS) return this.fail('和房主的連線中斷了。')
    clearTimeout(this.retry)
    this.retry = setTimeout(() => this.dial(), 3000)
    this.emit()
  }

  private fail(msg: string) {
    this.status = 'closed'
    this.error = msg
    this.left = true
    clearTimeout(this.retry)
    this.peer?.destroy()
    this.emit()
  }

  private onData(msg: ToGuest) {
    switch (msg.t) {
      case 'room':
        this.room = msg.room
        break
      case 'game':
        this.game = msg.game
        break
      case 'chat':
        this.chat = msg.replace ? msg.msgs : [...this.chat, ...msg.msgs].slice(-300)
        break
      case 'error':
        this.lastError = msg.msg
        break
      case 'rejected':
        return this.fail(msg.reason)
    }
    this.emit()
  }

  private send(msg: ToHost) {
    if (this.conn?.open) this.conn.send(msg)
  }

  act(a: Action) {
    this.send({ t: 'action', action: a })
  }

  say(text: string) {
    this.send({ t: 'chat', text })
  }

  setVoice(peerId: string | null) {
    this.send({ t: 'voice', peerId })
  }

  clearError() {
    this.lastError = null
    this.emit()
  }

  leave() {
    this.left = true
    clearTimeout(this.retry)
    this.conn?.close()
    setTimeout(() => this.peer?.destroy(), 200)
  }
}
