import { inject, provide, reactive } from 'vue'

const ConfirmKey = Symbol('confirm')

const defaults = {
  show: false,
  title: '确认操作',
  message: '',
  confirmText: '确认',
  cancelText: '取消',
  type: 'default'
}

export function provideConfirm() {
  const state = reactive({ ...defaults })
  let resolver = null

  function reset() {
    Object.assign(state, defaults)
  }

  function ask(options = {}) {
    Object.assign(state, defaults, options, { show: true })
    return new Promise(resolve => {
      resolver = resolve
    })
  }

  function settle(value) {
    if (resolver) resolver(value)
    resolver = null
    reset()
  }

  provide(ConfirmKey, ask)

  return {
    confirmState: state,
    confirmAccept: () => settle(true),
    confirmCancel: () => settle(false)
  }
}

export function useConfirm() {
  const ask = inject(ConfirmKey, null)
  if (ask) return ask
  return async options => window.confirm(options?.message || options?.title || '确认操作')
}
