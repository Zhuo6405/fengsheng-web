import type Peer from 'peerjs'
import type { MediaConnection } from 'peerjs'

/**
 * 語音：每個開麥克風的人彼此直接連線（mesh），朋友局 4–8 人夠用。
 * 為了避免兩邊同時撥號，由 peer id 比較小的一方撥給比較大的一方。
 */
export class VoiceMesh {
  stream: MediaStream | null = null
  muted = false
  error: string | null = null
  version = 0
  private calls = new Map<string, MediaConnection>()
  private audios = new Map<string, HTMLAudioElement>()
  private subs = new Set<() => void>()
  private roster: string[] = []

  private peer: Peer
  private report: (peerId: string | null) => void

  constructor(peer: Peer, report: (peerId: string | null) => void) {
    this.peer = peer
    this.report = report
    peer.on('call', (c) => this.onCall(c))
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

  get on() {
    return !!this.stream
  }

  get connectedCount() {
    return [...this.audios.keys()].length
  }

  async enable() {
    if (this.stream) return
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      this.error = null
      this.muted = false
      this.report(this.peer.id)
      this.sync(this.roster)
    } catch (e) {
      const name = (e as { name?: string }).name
      this.error = name === 'NotAllowedError' ? '沒有取得麥克風權限，請在瀏覽器網址列允許使用麥克風。' : '找不到可用的麥克風。'
    }
    this.emit()
  }

  disable() {
    for (const c of this.calls.values()) c.close()
    this.calls.clear()
    for (const a of this.audios.values()) a.remove()
    this.audios.clear()
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.report(null)
    this.emit()
  }

  setMuted(m: boolean) {
    this.muted = m
    this.stream?.getAudioTracks().forEach((t) => (t.enabled = !m))
    this.emit()
  }

  /** 房間的語音名單更新時呼叫 */
  sync(peerIds: string[]) {
    this.roster = peerIds
    if (!this.stream) return
    const others = peerIds.filter((id) => id !== this.peer.id)
    for (const [id, c] of this.calls) {
      if (!others.includes(id)) {
        c.close()
        this.drop(id)
      }
    }
    for (const id of others) {
      if (this.calls.has(id) || this.peer.id > id) continue
      this.attach(this.peer.call(id, this.stream))
    }
  }

  private onCall(c: MediaConnection) {
    if (!this.stream) {
      c.close()
      return
    }
    c.answer(this.stream)
    this.attach(c)
  }

  private attach(c: MediaConnection) {
    const id = c.peer
    this.calls.get(id)?.close()
    this.calls.set(id, c)
    c.on('stream', (remote) => {
      let a = this.audios.get(id)
      if (!a) {
        a = document.createElement('audio')
        a.autoplay = true
        a.dataset.voicePeer = id
        a.style.display = 'none'
        document.body.appendChild(a)
        this.audios.set(id, a)
      }
      a.srcObject = remote
      void a.play().catch(() => {})
      this.emit()
    })
    c.on('close', () => this.drop(id))
    c.on('error', () => this.drop(id))
  }

  private drop(id: string) {
    this.calls.delete(id)
    this.audios.get(id)?.remove()
    this.audios.delete(id)
    this.emit()
  }

  dispose() {
    this.disable()
    this.subs.clear()
  }
}
