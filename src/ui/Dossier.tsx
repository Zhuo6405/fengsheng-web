import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { KIND_NAME, METHOD_NAME } from '../engine/data'
import type { Card, Method } from '../engine/types'
import type { GameView } from '../engine/view'

// 傳遞中的情報：一份蓋了「密電／文本／直達」印章的卷宗，在座位之間移動。
// 被接收時飛進收件人的座位後消失。

interface Shown {
  key: string
  method: Method
  card: Card | null
  seat: number
  landed: boolean
}

function seatXY(ring: HTMLElement | null, seat: number) {
  if (!ring) return null
  const el = ring.querySelector<HTMLElement>(`[data-seat="${seat}"]`)
  if (!el) return null
  const r = el.getBoundingClientRect()
  const R = ring.getBoundingClientRect()
  return { x: r.left - R.left + r.width / 2, y: r.top - R.top + r.height / 2 }
}

export function useDossier(v: GameView): Shown | null {
  const [shown, setShown] = useState<Shown | null>(null)
  const prev = useRef<GameView | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => {
    const p = prev.current
    prev.current = v
    const t = v.trans
    if (t) {
      setShown({
        key: `${v.turnNo}-${t.sender}`,
        method: t.method,
        card: t.card,
        seat: t.holder,
        landed: false,
      })
      return
    }
    if (p?.trans) {
      // 誰拿到了：情報數變多的那位
      const to = v.players.find((pl) => pl.intel.length > p.players[pl.seat].intel.length)
      if (to) {
        const card = to.intel[to.intel.length - 1] ?? null
        setShown((s) => (s ? { ...s, seat: to.seat, card, landed: true } : null))
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setShown(null), 1500)
        return
      }
    }
    // 落地動畫播完前不要提早清掉
    setShown((s) => (s?.landed ? s : null))
  }, [v])
  useEffect(() => () => clearTimeout(timer.current), [])
  return shown
}

export function Dossier({ shown, ringRef }: { shown: Shown; ringRef: RefObject<HTMLDivElement | null> }) {
  const [xy, setXY] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    const measure = () => {
      const p = seatXY(ringRef.current, shown.seat)
      if (p) setXY(p)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [shown.seat, ringRef])
  if (!xy) return null
  const c = shown.card
  return (
    <div
      className={`dossier m-${shown.method} ${shown.landed ? 'is-landed' : ''}`}
      style={{ transform: `translate(${xy.x}px, ${xy.y}px)` }}
      aria-hidden
    >
      <div className="dossier-inner">
        <span className="dossier-tab" />
        <span className={`dossier-slip ${c ? `c-${c.colour}` : 'is-hidden'}`}>{c ? KIND_NAME[c.kind] : '？'}</span>
        <span className="dossier-stamp">{METHOD_NAME[shown.method]}</span>
      </div>
    </div>
  )
}
