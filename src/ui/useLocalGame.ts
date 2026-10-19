import { useCallback, useEffect, useMemo, useState } from 'react'
import { decide } from '../ai/ai'
import { applyAction, getDecisions, RuleError, startGame } from '../engine/engine'
import type { Action, GameConfig, GameState } from '../engine/types'
import { viewFor } from '../engine/view'

const AI_DELAY = 550

/**
 * 單機模式：人類坐在 humanSeat，其餘由 AI 操作。
 * 多人連線時，房主端會用同一套流程，只是把「人類」換成遠端玩家。
 */
export function useLocalGame(config: GameConfig, humanSeat: number) {
  const [state, setState] = useState<GameState>(() => startGame(config))
  const [error, setError] = useState<string | null>(null)
  /** 在這個回合內自動略過回應時機 */
  const [skipTurn, setSkipTurn] = useState<number | null>(null)

  const act = useCallback(
    (a: Action) => {
      try {
        setState((s) => applyAction(s, humanSeat, a))
        setError(null)
      } catch (e) {
        if (e instanceof RuleError) setError(e.message)
        else throw e
      }
    },
    [humanSeat],
  )

  useEffect(() => {
    if (state.result) return
    const decs = getDecisions(state)
    // 選角色：AI 立刻選
    const aiChoose = decs.find((d) => d.type === 'choose_character' && d.player !== humanSeat)
    if (aiChoose) {
      const id = setTimeout(() => {
        setState((s) => applyAction(s, aiChoose.player, decide(viewFor(s, aiChoose.player))))
      }, 60)
      return () => clearTimeout(id)
    }
    const d = decs[0]
    if (!d) return
    if (d.player === humanSeat) {
      // 自動略過：只略過與自己無關的回應時機
      if (d.type === 'priority' && skipTurn === state.turnNo) {
        const t = state.trans
        const top = state.stack[state.stack.length - 1]
        const aboutMe = (d.ctx === 'hopB' && t?.holder === humanSeat) || (top && top.target === humanSeat)
        if (!aboutMe) {
          const id = setTimeout(() => setState((s) => applyAction(s, humanSeat, { type: 'pass' })), 120)
          return () => clearTimeout(id)
        }
      }
      return
    }
    const delay = d.type === 'priority' ? AI_DELAY * 0.8 : AI_DELAY
    const id = setTimeout(() => {
      setState((s) => {
        const cur = getDecisions(s)[0]
        if (!cur || cur.player !== d.player) return s
        return applyAction(s, d.player, decide(viewFor(s, d.player)))
      })
    }, delay)
    return () => clearTimeout(id)
  }, [state, humanSeat, skipTurn])

  const view = useMemo(() => viewFor(state, humanSeat), [state, humanSeat])
  /** 現在在等誰（給畫面顯示） */
  const waitingOn = useMemo(() => getDecisions(state).map((d) => d.player), [state])

  return {
    view,
    act,
    error,
    clearError: () => setError(null),
    skipping: skipTurn === state.turnNo,
    skipThisTurn: () => setSkipTurn(state.turnNo),
    stopSkipping: () => setSkipTurn(null),
    waitingOn,
  }
}
