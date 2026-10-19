import { useState } from 'react'
import type { GameConfig } from '../engine/types'
import { Game } from './Game'
import { Lobby } from './Lobby'

export default function App() {
  const [config, setConfig] = useState<GameConfig | null>(null)
  if (!config) return <Lobby onStart={setConfig} />
  return <Game key={config.seed} config={config} onExit={() => setConfig(null)} />
}
