// 本機測試用的 PeerJS 配對伺服器：node scripts/peer-server.mjs
// 然後用 http://localhost:5173/fengsheng-web/?peer=localhost:9000 開遊戲
import { PeerServer } from 'peer'

PeerServer({ port: 9000, path: '/', host: '127.0.0.1', allow_discovery: false })
console.log('PeerServer listening on 127.0.0.1:9000')
