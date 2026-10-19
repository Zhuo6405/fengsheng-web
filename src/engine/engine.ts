import { CHARACTERS, CHAR_BY_ID, COLOUR_NAME, FACTION_NAME, FACTION_SETUPS, KIND_NAME, METHOD_NAME, buildCards } from './data'
import type {
  Action,
  Card,
  CardKind,
  Ctx,
  Decision,
  Faction,
  GameConfig,
  GameState,
  LegalPlay,
  Mission,
  Player,
  StackItem,
} from './types'

// ───────────────────────── 亂數（可重現） ─────────────────────────

function rand(s: GameState): number {
  let a = (s.rng + 0x6d2b79f5) | 0
  s.rng = a
  let t = Math.imul(a ^ (a >>> 15), 1 | a)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function shuffle<T>(s: GameState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(s) * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
  return arr
}

// ───────────────────────── 小工具 ─────────────────────────

export class RuleError extends Error {}

const fail = (msg: string): never => {
  throw new RuleError(msg)
}

export const cardOf = (s: GameState, id: number): Card => s.cards[id]
const nm = (s: GameState, p: number) => s.players[p].name
export const isAlive = (s: GameState, p: number) => s.players[p]?.status === 'alive'
export const aliveSeats = (s: GameState) => s.players.filter((pl) => pl.status === 'alive').map((pl) => pl.seat)

export function nextAlive(s: GameState, p: number, dir: 1 | -1 = 1): number {
  const n = s.players.length
  for (let k = 1; k <= n; k++) {
    const q = (((p + dir * k) % n) + n) % n
    if (isAlive(s, q)) return q
  }
  return -1
}

export const countColour = (s: GameState, ids: number[], colour: Card['colour']) =>
  ids.filter((id) => s.cards[id].colour === colour).length

export const cardLabel = (s: GameState, id: number) => {
  const c = s.cards[id]
  return `${COLOUR_NAME[c.colour]}·${KIND_NAME[c.kind]}`
}

function log(s: GameState, text: string, vis: number[] | null = null) {
  s.log.push({ seq: s.log.length, text, vis, turn: s.turnNo })
}

/** 角色的有效性別（蓋伏時無性別） */
export function genderOf(s: GameState, p: number): 'male' | 'female' | 'both' | null {
  const pl = s.players[p]
  if (!pl.character || !pl.charFaceUp) return null
  return CHAR_BY_ID[pl.character].gender
}

// ───────────────────────── 開局 ─────────────────────────

export function createGame(config: GameConfig): GameState {
  const n = config.players.length
  if (n < 3 || n > 9) fail('人數必須是 3 到 9 人')
  const [r, b, k] = config.factions
  if (r + b + k !== n) fail('陣營人數加總與玩家人數不符')
  const allowed = FACTION_SETUPS[n].some((f) => f[0] === r && f[1] === b && f[2] === k)
  if (!allowed) fail('不是這個人數的標準陣營配置')

  const s: GameState = {
    config,
    cards: buildCards(),
    players: config.players.map(
      (p, seat): Player => ({
        id: p.id,
        name: p.name,
        isAI: p.isAI,
        seat,
        faction: 'neutral',
        character: null,
        charOptions: [],
        charFaceUp: false,
        hand: [],
        intel: [],
        status: 'alive',
      }),
    ),
    deck: [],
    discard: [],
    rng: config.seed | 0,
    phase: 'choose_character',
    active: 0,
    turnNo: 0,
    locks: [],
    diverts: [],
    trans: null,
    stack: [],
    window: null,
    prio: null,
    reopenFrom: null,
    sub: null,
    log: [],
    deaths: [],
    killerCredit: [],
    deathWins: [],
    result: null,
    seq: 1,
  }
  const chars = shuffle(
    s,
    CHARACTERS.map((c) => c.id),
  )
  s.players.forEach((pl, i) => {
    pl.charOptions = [chars[2 * i], chars[2 * i + 1]]
  })
  log(s, `遊戲開始：${n} 人局（潛伏戰線 ${r}、軍情局 ${b}、打醬油的 ${k}）。請挑選角色。`)
  return s
}

function afterCharacters(s: GameState) {
  const facs: Faction[] = []
  const [r, b, k] = s.config.factions
  for (let i = 0; i < r; i++) facs.push('red')
  for (let i = 0; i < b; i++) facs.push('blue')
  for (let i = 0; i < k; i++) facs.push('neutral')
  shuffle(s, facs)
  s.players.forEach((pl, i) => {
    pl.faction = facs[i]
    pl.charFaceUp = !CHAR_BY_ID[pl.character!].hidden
    log(s, `你的身份是【${FACTION_NAME[pl.faction]}】`, [i])
  })
  s.deck = shuffle(
    s,
    s.cards.map((c) => c.id),
  )
  for (const pl of s.players) draw(s, pl.seat, 3, true)
  s.active = Math.floor(rand(s) * s.players.length)
  log(s, '身份牌已發出，每人起始手牌 3 張。')
  startTurn(s)
}

// ───────────────────────── 回合 ─────────────────────────

function draw(s: GameState, p: number, n: number, silent = false) {
  let got = 0
  for (let i = 0; i < n; i++) {
    if (s.deck.length === 0) {
      if (s.discard.length === 0) break
      s.deck = shuffle(s, s.discard)
      s.discard = []
      log(s, '牌庫用完，棄牌堆洗混成為新的牌庫。')
    }
    s.players[p].hand.push(s.deck.pop()!)
    got++
  }
  if (!silent && got > 0) log(s, `${nm(s, p)} 抽了 ${got} 張牌`)
}

function startTurn(s: GameState) {
  s.turnNo++
  s.locks = []
  s.diverts = []
  s.phase = 'play'
  log(s, `── 第 ${s.turnNo} 回合：${nm(s, s.active)} ──`)
  draw(s, s.active, 2)
  checkVictory(s)
}

function nextTurn(s: GameState) {
  s.trans = null
  s.window = null
  s.prio = null
  s.reopenFrom = null
  if (s.result) return
  const nx = nextAlive(s, s.active)
  if (nx < 0) return endDraw(s)
  s.active = nx
  startTurn(s)
}

function endDraw(s: GameState, oneLeft = false) {
  const reason = oneLeft ? '只剩一位玩家存活且無人達成勝利條件，平手。' : '所有玩家都已出局，平手。'
  s.result = { winners: [], declarer: null, reason }
  log(s, `★ ${reason}`)
  s.phase = 'over'
  revealAll(s)
}

function eliminate(s: GameState, p: number) {
  const pl = s.players[p]
  pl.status = 'out'
  log(s, `${pl.name} 無法傳出情報，輸掉遊戲。`)
  s.discard.push(...pl.hand, ...pl.intel)
  pl.hand = []
  pl.intel = []
  checkVictory(s)
}

function kill(s: GameState, p: number, killer: number | null) {
  const pl = s.players[p]
  pl.status = 'dead'
  s.deaths.push(p)
  log(s, `☠ ${pl.name} 獲得三張假情報，死亡。`)
  if (pl.faction === 'neutral' && pl.character) {
    const m = CHAR_BY_ID[pl.character].mission
    if (m.type === 'deathHandRed') {
      const reds = countColour(s, pl.hand, 'red')
      log(s, `${pl.name} 展示手牌：紅色卡牌 ${reds} 張。`)
      if (reds >= m.n) s.deathWins.push(p)
    }
  }
  if (killer != null && killer !== p && s.deaths.length >= 2) s.killerCredit.push(killer)
  s.discard.push(...pl.hand, ...pl.intel)
  pl.hand = []
  pl.intel = []
}

/** 玩家獲得一張情報（面朝上放在面前） */
function obtain(s: GameState, p: number, card: number, killer: number | null) {
  const pl = s.players[p]
  if (pl.status !== 'alive') {
    s.discard.push(card)
    return
  }
  pl.intel.push(card)
  log(s, `${pl.name} 獲得情報：${cardLabel(s, card)}`)
  if (countColour(s, pl.intel, 'black') >= 3) kill(s, p, killer)
  checkVictory(s)
}

// ───────────────────────── 勝負 ─────────────────────────

const factionWiped = (s: GameState, f: 'red' | 'blue') => {
  const members = s.players.filter((pl) => pl.faction === f)
  return members.length > 0 && members.every((pl) => pl.status !== 'alive')
}

function otherGenderOnField(s: GameState, p: number, g: 'male' | 'female') {
  return s.players.some((pl) => {
    if (pl.seat === p || pl.status !== 'alive') return false
    const og = genderOf(s, pl.seat)
    return og === g || og === 'both'
  })
}

function missionMet(s: GameState, p: number): boolean {
  const pl = s.players[p]
  if (!pl.character) return false
  const m: Mission = CHAR_BY_ID[pl.character].mission
  const alive = pl.status === 'alive'
  const aliveN = aliveSeats(s).length
  switch (m.type) {
    case 'intel':
      return alive && countColour(s, pl.intel, m.colour) >= m.n
    case 'nonBlack':
      return alive && pl.intel.length - countColour(s, pl.intel, 'black') >= m.n
    case 'totalIntel':
      return alive && pl.intel.length >= m.n
    case 'handSize':
      return alive && pl.hand.length >= m.n
    case 'handColours':
      return alive && countColour(s, pl.hand, 'red') >= m.red && countColour(s, pl.hand, 'blue') >= m.blue
    case 'wipeout':
      return alive && factionWiped(s, m.faction)
    case 'deathHandRed':
      return s.deathWins.includes(p)
    case 'killer':
      return alive && s.killerCredit.includes(p)
    case 'femaleDeclares':
      return alive && !otherGenderOnField(s, p, 'female') && aliveN === 1
    case 'maleDeclaresLowBlack':
      return alive && !otherGenderOnField(s, p, 'male') && aliveN === 1
    case 'lastTwo':
      return alive && aliveN === 2
    case 'firstDeathOrWipe':
      return s.deaths[0] === p || (alive && (factionWiped(s, 'red') || factionWiped(s, 'blue')))
  }
}

function checkVictory(s: GameState) {
  if (s.result) return
  const n = s.players.length
  for (let k = 0; k < n; k++) {
    const p = (s.active + k) % n
    const pl = s.players[p]
    if (pl.status === 'alive' && pl.faction !== 'neutral' && countColour(s, pl.intel, pl.faction) >= 3) {
      return declare(s, p, 'faction')
    }
    if (pl.faction === 'neutral' && missionMet(s, p)) return declare(s, p, 'mission')
  }
  if (aliveSeats(s).length <= 1) endDraw(s, aliveSeats(s).length === 1)
}

function declare(s: GameState, p: number, why: 'faction' | 'mission') {
  const pl = s.players[p]
  const winners = new Set<number>([p])
  let reason: string
  if (why === 'faction') {
    for (const q of s.players) if (q.faction === pl.faction) winners.add(q.seat)
    reason = `${pl.name} 集滿三張${pl.faction === 'red' ? '紅色' : '藍色'}情報，${FACTION_NAME[pl.faction]}獲勝！`
  } else {
    reason = `${pl.name}（${CHAR_BY_ID[pl.character!].name}）完成機密任務：${CHAR_BY_ID[pl.character!].missionText}`
    if (s.config.neutralAlliance) {
      for (const q of s.players) if (q.faction === 'neutral') winners.add(q.seat)
      reason += '（醬油同盟一同勝利）'
    }
  }
  // 「某人宣告勝利時」達成的機密任務
  const g = genderOf(s, p)
  for (const q of s.players) {
    if (winners.has(q.seat) || q.faction !== 'neutral' || q.status !== 'alive' || !q.character) continue
    const m = CHAR_BY_ID[q.character].mission
    if (m.type === 'femaleDeclares' && (g === 'female' || g === 'both')) winners.add(q.seat)
    if (m.type === 'maleDeclaresLowBlack' && (g === 'male' || g === 'both') && countColour(s, q.intel, 'black') <= 1)
      winners.add(q.seat)
  }
  s.result = { winners: [...winners].sort((a, b) => a - b), declarer: p, reason }
  s.phase = 'over'
  s.prio = null
  s.window = null
  log(s, `★ ${reason}`)
  revealAll(s)
}

function revealAll(s: GameState) {
  const parts = s.players.map(
    (pl) => `${pl.name}＝${FACTION_NAME[pl.faction]}（${pl.character ? CHAR_BY_ID[pl.character].name : '—'}）`,
  )
  log(s, `身份公開：${parts.join('、')}`)
}

// ───────────────────────── 情報傳遞 ─────────────────────────

/** 依目前狀態算出這一跳情報會傳到誰 */
export function peekNext(s: GameState): number {
  const t = s.trans
  if (!t) return -1
  if (t.toSender) return t.sender
  const free = (q: number) => !s.diverts.includes(q) || s.locks.includes(q)
  if (t.method === 'direct') {
    const tg = t.target!
    if (!isAlive(s, tg) || !free(tg)) return t.sender
    return tg
  }
  const n = s.players.length
  for (let k = 1; k <= n; k++) {
    const q = (((t.holder + t.dir * k) % n) + n) % n
    if (q === t.sender) return t.sender
    if (!isAlive(s, q) || !free(q)) continue
    return q
  }
  return t.sender
}

export function currentCtx(s: GameState): Ctx {
  if (s.stack.length) return 'resp'
  return s.window ?? 'play'
}

/** 回傳玩家 p 在目前時機能用的所有手牌與目標 */
export function legalPlays(s: GameState, p: number, ctx: Ctx = currentCtx(s)): LegalPlay[] {
  const pl = s.players[p]
  if (!pl || pl.status !== 'alive' || s.result) return []
  const out: LegalPlay[] = []
  const others = aliveSeats(s).filter((q) => q !== p)
  const t = s.trans
  const burnRefs = () => {
    const refs: { target: number; ref: number }[] = []
    for (const q of aliveSeats(s))
      for (const id of s.players[q].intel) if (s.cards[id].colour === 'black') refs.push({ target: q, ref: id })
    return refs
  }
  for (const id of pl.hand) {
    const kind = s.cards[id].kind
    const add = (extra: Partial<LegalPlay> = {}) => out.push({ card: id, kind, ...extra })
    if (ctx === 'resp') {
      if (kind === 'counter') {
        const top = s.stack[s.stack.length - 1]
        if (top.user !== p) add({ refs: [{ target: top.user, ref: top.uid }] })
      }
      continue
    }
    switch (kind) {
      case 'lock': {
        if (p !== s.active || (ctx !== 'play' && ctx !== 'hopA')) break
        const tg = others.filter((q) => !s.locks.includes(q))
        if (tg.length) add({ targets: tg })
        break
      }
      case 'divert': {
        if (ctx !== 'hopA' || !t) break
        const tg = aliveSeats(s).filter((q) => q !== t.sender && !s.locks.includes(q) && !s.diverts.includes(q))
        if (tg.length) add({ targets: tg })
        break
      }
      case 'intercept':
        if (ctx === 'hopA' && t && t.obtainedBy == null && p !== s.active) add()
        break
      case 'return':
        if (ctx === 'hopB' && t && p === t.holder && p !== t.sender && !s.locks.includes(p)) add()
        break
      case 'decrypt':
        if (ctx === 'hopB' && t && p === t.holder && !t.peeked.includes(p) && t.method !== 'text') add()
        break
      case 'burn': {
        if (ctx === 'play' && p !== s.active) break
        const refs = burnRefs()
        if (refs.length) add({ refs })
        break
      }
      case 'probe':
        if (ctx === 'play' && p === s.active && others.length) add({ targets: others })
        break
      case 'chaos':
        if (ctx === 'play' && p === s.active) add()
        break
      case 'counter':
        break
    }
  }
  return out
}

// ───────────────────────── 堆疊（後發先至） ─────────────────────────

function pushStack(s: GameState, p: number, card: number, kind: CardKind, target?: number, ref?: number) {
  const pl = s.players[p]
  pl.hand = pl.hand.filter((c) => c !== card)
  if (s.stack.length === 0 && s.window) s.reopenFrom = nextAlive(s, p)
  const item: StackItem = { uid: s.seq++, card, kind, user: p, target, targetRef: ref, countered: false }
  s.stack.push(item)
  let text = `${pl.name} 使用【${KIND_NAME[kind]}】`
  if (kind === 'counter') {
    const tg = s.stack.find((x) => x.uid === ref)
    if (tg) text += `，目標是 ${nm(s, tg.user)} 的【${KIND_NAME[tg.kind]}】`
  } else if (kind === 'burn' && target != null && ref != null) {
    text += `，燒毀 ${nm(s, target)} 的 ${cardLabel(s, ref)}`
  } else if (target != null) {
    text += `，目標：${nm(s, target)}`
  }
  log(s, text)
  s.prio = { current: nextAlive(s, p), passes: 0 }
}

function resolveTop(s: GameState) {
  const it = s.stack.pop()!
  const c = s.cards[it.card]
  s.discard.push(it.card)
  if (it.countered) {
    log(s, `${nm(s, it.user)} 的【${KIND_NAME[it.kind]}】被識破，無效。`)
    return
  }
  const t = s.trans
  switch (it.kind) {
    case 'counter': {
      const tg = s.stack.find((x) => x.uid === it.targetRef)
      if (tg) tg.countered = true
      break
    }
    case 'lock':
      if (!s.locks.includes(it.target!)) s.locks.push(it.target!)
      log(s, `${nm(s, it.target!)} 被鎖定：本回合情報傳到他時必須接收。`)
      break
    case 'divert':
      if (!s.diverts.includes(it.target!)) s.diverts.push(it.target!)
      log(s, `${nm(s, it.target!)} 被調虎離山，不參與本次傳遞。`)
      break
    case 'intercept':
      if (t && t.obtainedBy == null) {
        t.obtainedBy = it.user
        log(s, `${nm(s, it.user)} 截獲了情報！`)
        s.window = null
        s.reopenFrom = null
        obtain(s, it.user, t.card, t.sender)
      } else {
        log(s, `${nm(s, it.user)} 的截獲落空。`)
      }
      break
    case 'return':
      if (t) {
        t.returned = true
        log(s, `${nm(s, it.user)} 退回情報，情報反方向傳遞。`)
      }
      break
    case 'decrypt':
      if (t && !t.peeked.includes(it.user)) {
        t.peeked.push(it.user)
        log(s, `${nm(s, it.user)} 破譯了情報。`)
        log(s, `破譯結果：這份情報是 ${cardLabel(s, t.card)}`, [it.user])
      }
      break
    case 'burn': {
      const q = s.players[it.target!]
      if (q.status === 'alive' && q.intel.includes(it.targetRef!)) {
        q.intel = q.intel.filter((x) => x !== it.targetRef)
        s.discard.push(it.targetRef!)
        log(s, `${q.name} 的一張假情報被燒毀。`)
      }
      break
    }
    case 'probe': {
      const tgt = it.target!
      const spec = c.probe!
      const match = s.players[tgt].faction === spec.guess
      const eff = spec.effect === 'draw2' ? '抽二張牌' : '棄一張牌'
      const alt = spec.effect === 'draw2' ? '我是臥底' : '我是好人'
      log(
        s,
        `試探內容：「我打賭你是${FACTION_NAME[spec.guess]}。如果是，你${eff}；否則你說「${alt}」。」—— ${
          match ? '猜中了' : '沒猜中'
        }`,
        [it.user, tgt],
      )
      if (!isAlive(s, tgt)) break
      if (!match) {
        log(s, `${nm(s, tgt)} 說：「${alt}」`)
      } else if (spec.effect === 'draw2') {
        draw(s, tgt, 2)
        checkVictory(s)
      } else if (s.players[tgt].hand.length > 0) {
        s.sub = { type: 'discard', player: tgt }
      } else {
        log(s, `${nm(s, tgt)} 宣告棄一張牌（沒有手牌）。`)
      }
      break
    }
    case 'chaos': {
      const order: number[] = []
      let q = it.user
      if (isAlive(s, q)) order.push(q)
      for (let k = 0; k < s.players.length; k++) {
        q = nextAlive(s, q)
        if (q < 0 || order.includes(q)) break
        order.push(q)
      }
      const cards: number[] = []
      for (let i = 0; i < order.length; i++) {
        if (s.deck.length === 0) {
          if (s.discard.length === 0) break
          s.deck = shuffle(s, s.discard)
          s.discard = []
        }
        cards.push(s.deck.pop()!)
      }
      shuffle(s, cards)
      log(s, `真偽莫辨：翻出 ${cards.length} 張牌，從 ${nm(s, it.user)} 開始每人隨機選一張作為情報。`)
      s.sub = { type: 'chaos', cards, order, i: 0, user: it.user }
      break
    }
  }
}

// ───────────────────────── 自動推進 ─────────────────────────

function stepTransmit(s: GameState): boolean {
  const t = s.trans!
  if (t.obtainedBy != null) {
    nextTurn(s)
    return true
  }
  if (s.window === 'hopA') {
    s.window = null
    const r = peekNext(s)
    t.toSender = false
    t.holder = r
    t.hops++
    t.stage = 'B'
    log(s, `情報傳到 ${nm(s, r)}。`)
    s.window = 'hopB'
    s.prio = { current: r, passes: 0 }
    return true
  }
  if (s.window === 'hopB') {
    s.window = null
    if (t.returned) {
      t.returned = false
      if (t.method === 'direct') t.toSender = true
      else t.dir = t.dir === 1 ? -1 : 1
      t.stage = 'hopStart'
      return true
    }
    t.stage = 'decide'
    if (t.holder === t.sender || s.locks.includes(t.holder)) {
      log(s, t.holder === t.sender ? `情報回到傳出者，${nm(s, t.holder)} 必須接收。` : `${nm(s, t.holder)} 被鎖定，必須接收。`)
      t.obtainedBy = t.holder
      obtain(s, t.holder, t.card, t.sender)
      if (!s.result) nextTurn(s)
      return true
    }
    return false
  }
  if (t.stage === 'hopStart') {
    t.stage = 'A'
    s.window = 'hopA'
    s.prio = { current: isAlive(s, s.active) ? s.active : nextAlive(s, s.active), passes: 0 }
    return true
  }
  return false
}

function run(s: GameState) {
  for (let guard = 0; guard < 100000; guard++) {
    if (s.result || s.phase === 'over' || s.phase === 'choose_character') return
    if (s.sub) {
      if (s.sub.type === 'chaos') {
        const sub = s.sub
        while (sub.i < sub.order.length && !isAlive(s, sub.order[sub.i])) sub.i++
        if (sub.i >= sub.order.length || sub.cards.length === 0) {
          s.discard.push(...sub.cards)
          s.sub = null
          continue
        }
      } else if (!isAlive(s, s.sub.player) || s.players[s.sub.player].hand.length === 0) {
        s.sub = null
        continue
      }
      return
    }
    if (s.prio) {
      const p = s.prio.current
      if (p < 0) {
        s.prio = null
        continue
      }
      if (!isAlive(s, p)) {
        s.prio.current = nextAlive(s, p)
        continue
      }
      if (legalPlays(s, p).length > 0) return
      doPass(s)
      continue
    }
    if (s.stack.length) {
      resolveTop(s)
      continue
    }
    if (s.reopenFrom != null) {
      const r = s.reopenFrom
      s.reopenFrom = null
      if (s.window) s.prio = { current: isAlive(s, r) ? r : nextAlive(s, r), passes: 0 }
      continue
    }
    if (s.phase === 'play') {
      if (!isAlive(s, s.active)) {
        nextTurn(s)
        continue
      }
      if (s.players[s.active].hand.length === 0) {
        eliminate(s, s.active)
        nextTurn(s)
        continue
      }
      return
    }
    if (s.phase === 'transmit') {
      if (stepTransmit(s)) continue
      return
    }
    return
  }
  throw new Error('引擎推進次數過多（可能有無限迴圈）')
}

function doPass(s: GameState) {
  const pr = s.prio!
  pr.passes++
  if (pr.passes >= aliveSeats(s).length) s.prio = null
  else pr.current = nextAlive(s, pr.current)
}

// ───────────────────────── 對外 API ─────────────────────────

export function getDecisions(s: GameState): Decision[] {
  if (s.result) return []
  if (s.phase === 'choose_character')
    return s.players.filter((pl) => !pl.character).map((pl) => ({ type: 'choose_character', player: pl.seat, options: pl.charOptions }))
  if (s.sub) {
    if (s.sub.type === 'discard') return [{ type: 'discard', player: s.sub.player }]
    return [{ type: 'chaos_pick', player: s.sub.order[s.sub.i], slots: s.sub.cards.map((_, i) => i) }]
  }
  if (s.prio) return [{ type: 'priority', player: s.prio.current, ctx: currentCtx(s) }]
  if (s.phase === 'transmit' && s.trans?.stage === 'decide') return [{ type: 'accept', player: s.trans.holder }]
  if (s.phase === 'play') return [{ type: 'play', player: s.active }]
  return []
}

/** 套用一個動作，回傳新的狀態（不修改傳入的狀態） */
export function applyAction(state: GameState, p: number, a: Action): GameState {
  const s: GameState = structuredClone(state)
  const dec = getDecisions(s).find((d) => d.player === p)
  if (!dec) fail('現在不是你的行動時機')
  const pl = s.players[p]

  switch (dec!.type) {
    case 'choose_character': {
      if (a.type !== 'choose_character' || !pl.charOptions.includes(a.character)) fail('請從兩張角色中選一張')
      pl.character = (a as { character: string }).character
      if (s.players.every((x) => x.character)) afterCharacters(s)
      break
    }
    case 'discard': {
      if (a.type !== 'discard' || !pl.hand.includes(a.card)) fail('請選一張手牌棄掉')
      const card = (a as { card: number }).card
      pl.hand = pl.hand.filter((c) => c !== card)
      s.discard.push(card)
      log(s, `${pl.name} 棄了一張牌（暗棄）。`)
      s.sub = null
      break
    }
    case 'chaos_pick': {
      const sub = s.sub
      if (a.type !== 'chaos_pick' || sub?.type !== 'chaos' || !(a.slot >= 0 && a.slot < sub.cards.length)) fail('請選一張牌')
      const ch = s.sub as Extract<GameState['sub'], { type: 'chaos' }>
      const [card] = ch.cards.splice((a as { slot: number }).slot, 1)
      ch.i++
      obtain(s, p, card, ch.user)
      break
    }
    case 'accept': {
      const t = s.trans!
      if (a.type === 'accept') {
        t.obtainedBy = p
        obtain(s, p, t.card, t.sender)
        if (!s.result) nextTurn(s)
      } else if (a.type === 'decline') {
        log(s, `${pl.name} 不接收。`)
        if (t.method === 'direct') t.toSender = true
        t.stage = 'hopStart'
      } else fail('請選擇接收或不接收')
      break
    }
    case 'priority':
    case 'play': {
      if (a.type === 'pass') {
        if (dec!.type === 'play') fail('出牌階段必須傳出一張情報')
        doPass(s)
        break
      }
      if (a.type === 'send') {
        if (dec!.type !== 'play') fail('現在不能傳情報')
        if (!pl.hand.includes(a.card)) fail('這張牌不在你手上')
        const c = s.cards[a.card]
        if (c.method === 'direct') {
          if (a.target == null || a.target === p || !isAlive(s, a.target)) fail('直達情報要指定另一位存活的玩家')
        }
        pl.hand = pl.hand.filter((x) => x !== a.card)
        s.trans = {
          card: a.card,
          sender: p,
          method: c.method,
          dir: 1,
          holder: p,
          target: c.method === 'direct' ? a.target! : null,
          stage: 'hopStart',
          peeked: [p],
          toSender: false,
          returned: false,
          obtainedBy: null,
          hops: 0,
        }
        s.phase = 'transmit'
        const face = c.method === 'text' ? `：${cardLabel(s, a.card)}` : ''
        const to = c.method === 'direct' ? `給 ${nm(s, a.target!)}` : ''
        log(s, `${pl.name} 以【${METHOD_NAME[c.method]}】傳出情報${to}${face}`)
        break
      }
      if (a.type === 'play_card') {
        let pa = a
        const ctx = currentCtx(s)
        const lp = legalPlays(s, p, ctx).find((x) => x.card === pa.card)
        if (!lp) fail('這張牌現在不能使用')
        const play = lp as LegalPlay
        if (play.targets && (pa.target == null || !play.targets.includes(pa.target))) fail('請選擇合法的目標')
        if (play.refs && !play.refs.some((r) => r.ref === pa.targetRef && r.target === pa.target)) {
          if (play.refs.length === 1 && play.kind === 'counter') {
            pa = { ...pa, target: play.refs[0].target, targetRef: play.refs[0].ref }
          } else fail('請選擇要作用的對象')
        }
        pushStack(s, p, pa.card, play.kind, pa.target, pa.targetRef)
        break
      }
      fail('無效的動作')
    }
  }
  run(s)
  return s
}

/** 建立後先讓 AI/流程推進（choose_character 階段不會自動推進） */
export function startGame(config: GameConfig): GameState {
  const s = createGame(config)
  run(s)
  return s
}
