import type { OpenxirpApi } from './index'

declare global {
  interface Window {
    api: OpenxirpApi
  }
}

export {}
