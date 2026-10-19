import { useState } from 'react'
import type { GameConfig } from '../engine/types'
import { GuestSession } from '../net/guest'
import { HostSession, savedHostRoom } from '../net/host'
import { LocalGame } from './Game'
import { Lobby } from './Lobby'
import { GuestScreen, HostScreen } from './Online'

type Mode =
  | { k: 'lobby' }
  | { k: 'local'; config: GameConfig }
  | { k: 'host'; session: HostSession }
  | { k: 'guest'; session: GuestSession }

function clearRoomParam() {
  const u = new URL(location.href)
  if (u.searchParams.has('room')) {
    u.searchParams.delete('room')
    history.replaceState(null, '', u.toString())
  }
}

export default function App() {
  const [mode, setMode] = useState<Mode>({ k: 'lobby' })
  const back = () => {
    clearRoomParam()
    setMode({ k: 'lobby' })
  }

  switch (mode.k) {
    case 'local':
      return <LocalGame key={mode.config.seed} config={mode.config} onExit={back} />
    case 'host':
      return <HostScreen session={mode.session} onExit={back} />
    case 'guest':
      return <GuestScreen session={mode.session} onExit={back} />
    default:
      return (
        <Lobby
          onLocal={(config) => setMode({ k: 'local', config })}
          onHost={(name, restore) => {
            const saved = restore ? savedHostRoom() ?? undefined : undefined
            const s = new HostSession(saved?.name ?? name, saved)
            void s.open().catch(() => {})
            setMode({ k: 'host', session: s })
          }}
          onJoin={(name, code) => {
            const s = new GuestSession(code, name)
            s.connect()
            setMode({ k: 'guest', session: s })
          }}
        />
      )
  }
}
