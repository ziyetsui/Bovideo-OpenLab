const toggle = document.querySelector('[data-menu-toggle]')
const navigation = document.querySelector('[data-site-navigation]')

if (toggle instanceof HTMLButtonElement && navigation instanceof HTMLElement) {
  const firstLink = navigation.querySelector('[data-locale-link]')
  const openLabel = toggle.dataset.openLabel ?? toggle.textContent ?? ''
  const closeLabel = toggle.dataset.closeLabel ?? openLabel

  const setOpen = (open, focusFirstLink = false) => {
    toggle.setAttribute('aria-expanded', String(open))
    toggle.textContent = open ? closeLabel : openLabel
    navigation.dataset.menuState = open ? 'open' : 'closed'
    if (open && focusFirstLink && firstLink instanceof HTMLElement) firstLink.focus()
  }

  document.documentElement.dataset.menuReady = 'true'
  setOpen(false)
  toggle.addEventListener('click', () => setOpen(toggle.getAttribute('aria-expanded') !== 'true', true))
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
      setOpen(false)
      toggle.focus()
    }
  })
}
