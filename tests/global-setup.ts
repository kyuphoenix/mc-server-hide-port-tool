import { disposeSharedMiniflare } from './helpers/d1'

export async function setup(): Promise<() => Promise<void>> {
  return async () => {
    await disposeSharedMiniflare()
  }
}
