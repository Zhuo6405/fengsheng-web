// 風聲（108 張版）規則引擎的資料型別
// 引擎是純函式：同一份程式碼給單機、房主（P2P 權威端）與 AI 使用。

export type Colour = 'red' | 'blue' | 'black'
/** 密電 / 直達 / 文本 */
export type Method = 'secret' | 'direct' | 'text'
export type CardKind =
  | 'lock' // 鎖定
  | 'divert' // 調虎離山
  | 'intercept' // 截獲
  | 'return' // 退回
  | 'decrypt' // 破譯
  | 'burn' // 燒毀
  | 'counter' // 識破
  | 'probe' // 試探
  | 'chaos' // 真偽莫辨

/** 潛伏戰線 / 軍情局 / 打醬油的 */
export type Faction = 'red' | 'blue' | 'neutral'

export interface ProbeSpec {
  guess: Faction
  /** 猜中時：抽二張 / 棄一張 */
  effect: 'draw2' | 'discard1'
}

export interface Card {
  id: number
  kind: CardKind
  colour: Colour
  method: Method
  probe?: ProbeSpec
}

export type Gender = 'male' | 'female' | 'both'

export type Mission =
  | { type: 'intel'; colour: 'red' | 'blue'; n: number }
  | { type: 'nonBlack'; n: number }
  | { type: 'totalIntel'; n: number }
  | { type: 'handSize'; n: number }
  | { type: 'handColours'; red: number; blue: number }
  | { type: 'wipeout'; faction: 'red' | 'blue' }
  | { type: 'deathHandRed'; n: number }
  | { type: 'killer' }
  | { type: 'femaleDeclares' }
  | { type: 'maleDeclaresLowBlack' }
  | { type: 'lastTwo' }
  | { type: 'firstDeathOrWipe' }

export interface CharacterDef {
  id: string
  name: string
  gender: Gender
  /** 潛伏角色：開局蓋伏 */
  hidden: boolean
  skills: string[]
  missionText: string
  mission: Mission
}

export type PlayerStatus = 'alive' | 'dead' | 'out'

export interface Player {
  id: string
  name: string
  isAI: boolean
  seat: number
  faction: Faction
  character: string | null
  charOptions: string[]
  charFaceUp: boolean
  hand: number[]
  intel: number[]
  status: PlayerStatus
}

export interface PlayerSeed {
  id: string
  name: string
  isAI: boolean
}

export interface GameConfig {
  players: PlayerSeed[]
  /** [潛伏戰線, 軍情局, 打醬油的] */
  factions: [number, number, number]
  neutralAlliance: boolean
  seed: number
}

export interface StackItem {
  uid: number
  card: number
  kind: CardKind
  user: number
  target?: number
  /** 燒毀時指定的情報 / 識破時指定的堆疊項目 uid */
  targetRef?: number
  countered: boolean
}

export interface Transmission {
  card: number
  sender: number
  method: Method
  dir: 1 | -1
  holder: number
  target: number | null
  stage: 'hopStart' | 'A' | 'B' | 'decide'
  /** 已經看過情報內容的玩家 */
  peeked: number[]
  toSender: boolean
  returned: boolean
  obtainedBy: number | null
  hops: number
}

export type SubDecision =
  | { type: 'discard'; player: number }
  | { type: 'chaos'; cards: number[]; order: number[]; i: number; user: number }

export interface LogEntry {
  seq: number
  text: string
  /** null = 所有人可見 */
  vis: number[] | null
  turn: number
}

export interface GameResult {
  winners: number[]
  declarer: number | null
  reason: string
}

export interface GameState {
  config: GameConfig
  cards: Card[]
  players: Player[]
  deck: number[]
  discard: number[]
  rng: number
  phase: 'choose_character' | 'play' | 'transmit' | 'over'
  active: number
  turnNo: number
  locks: number[]
  diverts: number[]
  trans: Transmission | null
  stack: StackItem[]
  window: 'hopA' | 'hopB' | null
  prio: { current: number; passes: number } | null
  reopenFrom: number | null
  sub: SubDecision | null
  log: LogEntry[]
  deaths: number[]
  /** 某位玩家「親手」造成第二位以後的死亡（職業殺手） */
  killerCredit: number[]
  /** 死亡時達成機密任務的玩家（老鬼） */
  deathWins: number[]
  result: GameResult | null
  seq: number
}

export type Ctx = 'play' | 'hopA' | 'hopB' | 'resp'

export type Decision =
  | { type: 'choose_character'; player: number; options: string[] }
  | { type: 'play'; player: number }
  | { type: 'priority'; player: number; ctx: Ctx }
  | { type: 'accept'; player: number }
  | { type: 'discard'; player: number }
  | { type: 'chaos_pick'; player: number; slots: number[] }

export type Action =
  | { type: 'choose_character'; character: string }
  | { type: 'play_card'; card: number; target?: number; targetRef?: number }
  | { type: 'send'; card: number; target?: number }
  | { type: 'pass' }
  | { type: 'accept' }
  | { type: 'decline' }
  | { type: 'discard'; card: number }
  | { type: 'chaos_pick'; slot: number }

/** 某張手牌在目前時機可以怎麼用 */
export interface LegalPlay {
  card: number
  kind: CardKind
  /** 需要指定的目標玩家（座位） */
  targets?: number[]
  /** 燒毀：可選的情報；識破：可選的堆疊項目 */
  refs?: { target: number; ref: number }[]
}
