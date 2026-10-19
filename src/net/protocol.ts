import type { Action } from '../engine/types'
import type { GameView } from '../engine/view'

// 房主與玩家之間的訊息格式（PeerJS DataConnection，JSON）

export interface RoomSettings {
  /** 遊戲人數（含 AI 補位） */
  count: number
  setupIdx: number
  alliance: boolean
}

export interface Member {
  clientId: string
  name: string
  connected: boolean
  isHost: boolean
  /** 遊戲中的座位 */
  seat: number | null
}

export interface RoomInfo {
  code: string
  members: Member[]
  settings: RoomSettings
  started: boolean
  /** 開著麥克風的人：clientId → PeerJS id */
  voice: { clientId: string; peerId: string }[]
}

export interface ChatMsg {
  id: number
  clientId: string | null
  name: string
  text: string
  ts: number
  system?: boolean
}

export interface GamePacket {
  view: GameView
  waitingOn: number[]
  deadline: number | null
  /** 被 AI 代打中的座位 */
  aiControlled: number[]
}

export type ToHost =
  | { t: 'hello'; clientId: string; name: string }
  | { t: 'action'; action: Action }
  | { t: 'chat'; text: string }
  | { t: 'voice'; peerId: string | null }

export type ToGuest =
  | { t: 'room'; room: RoomInfo }
  | { t: 'game'; game: GamePacket | null }
  | { t: 'chat'; msgs: ChatMsg[]; replace?: boolean }
  | { t: 'error'; msg: string }
  | { t: 'rejected'; reason: string }

export const PEER_PREFIX = 'fsweb-'
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function makeCode(len = 5) {
  let s = ''
  for (let i = 0; i < len; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
  return s
}

export function normaliseCode(s: string) {
  return s
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
}

/** 每個瀏覽器固定一個 id，用來斷線重連時認回原本的座位 */
export function clientId(): string {
  try {
    let id = localStorage.getItem('fs-client')
    if (!id) {
      id = Math.random().toString(36).slice(2, 12)
      localStorage.setItem('fs-client', id)
    }
    return id
  } catch {
    return Math.random().toString(36).slice(2, 12)
  }
}

/** PeerJS 連線設定。網址加上 ?peer=localhost:9000 可以改用自架的配對伺服器（測試用）。 */
export function peerOptions(): Record<string, unknown> {
  const p = new URLSearchParams(location.search).get('peer')
  const base = {
    debug: 0,
    config: {
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }],
    },
  }
  if (!p) return base
  const [host, port] = p.split(':')
  return { ...base, host, port: Number(port || 9000), path: '/', secure: false }
}
