/**
 * Put text on the clipboard, from a renderer that may not have the modern API.
 *
 * `navigator.clipboard` is gated on a secure context. A Vite dev server on
 * `localhost` is one and the packaged app's own scheme is one, but the harness,
 * a `file://` load and any future preview build are not — and the failure mode
 * is a rejected promise with nothing on screen, which is the worst possible
 * shape for a control whose entire feedback is "did it work?".
 *
 * So: the modern call, and `execCommand('copy')` behind it. The fallback is
 * deprecated and is not going anywhere — it is the only synchronous copy the
 * platform has ever had, and every browser still implements it.
 *
 * The textarea is off-screen rather than `display: none`, because a hidden
 * element cannot hold a selection and the copy silently does nothing.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through: a rejection here is exactly the case the fallback is for.
  }

  try {
    const holder = document.createElement('textarea')
    holder.value = text
    holder.setAttribute('readonly', '')
    holder.setAttribute('aria-hidden', 'true')
    holder.style.position = 'fixed'
    holder.style.top = '-1000px'
    holder.style.opacity = '0'
    document.body.appendChild(holder)
    holder.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(holder)
    return ok
  } catch {
    return false
  }
}
