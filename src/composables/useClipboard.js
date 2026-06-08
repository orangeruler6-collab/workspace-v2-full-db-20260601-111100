export function useClipboard(showToast) {
  function handleCopy(text) {
    if (!text) return
    navigator.clipboard.writeText(text).then(() => {
      showToast('已复制', 'success')
    }).catch(() => {
      showToast('复制失败', 'error')
    })
  }

  return { handleCopy }
}
