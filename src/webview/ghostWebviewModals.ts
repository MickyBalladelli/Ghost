type GhostModalApi = {
  setVisibility: (modal: HTMLElement, visible: boolean, focusMemory: WeakMap<HTMLElement, HTMLElement>) => void
}

const ghostModal: GhostModalApi = {
  setVisibility: (modal, visible, focusMemory) => {
    modal.hidden = !visible
    if (visible) {
      const activeElement = document.activeElement
      if (activeElement instanceof HTMLElement && activeElement !== document.body && !modal.contains(activeElement)) {
        focusMemory.set(modal, activeElement)
      }
      modal.querySelector<HTMLElement>('button, input, select, textarea')?.focus()
      return
    }
    const returnFocus = focusMemory.get(modal)
    focusMemory.delete(modal)
    if (returnFocus && document.contains(returnFocus) && !returnFocus.closest('.modal-backdrop:not([hidden])')) {
      returnFocus.focus()
    }
  }
}

const ghostModalGlobal = globalThis as typeof globalThis & { GhostModal: GhostModalApi }
ghostModalGlobal.GhostModal = ghostModal
