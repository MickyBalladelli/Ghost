import type { Agent as HttpAgent } from 'node:http'
import type { Agent as HttpsAgent } from 'node:https'

export type RequestAgent = HttpAgent | HttpsAgent

export type GhostRequestInit = RequestInit & {
  agent?: RequestAgent
}

export type FetchLike = (url: string, init?: GhostRequestInit) => Promise<Response>
