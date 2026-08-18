type GhostComposerApi = {
  tokenEstimate: (value: string) => number
  isBusy: (status: string | undefined) => boolean
}

const ghostComposer: GhostComposerApi = {
  tokenEstimate: value => Math.ceil(value.length / 4),
  isBusy: status => status !== undefined && !['completed', 'cancelled', 'failed'].includes(status)
}

const ghostComposerGlobal = globalThis as typeof globalThis & { GhostComposer: GhostComposerApi }
ghostComposerGlobal.GhostComposer = ghostComposer
