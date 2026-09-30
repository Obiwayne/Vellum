/// <reference types="vite/client" />
import type { CanvasApi } from '@shared/api'

declare global {
  interface Window {
    canvasApi: CanvasApi
  }
}

export {}
