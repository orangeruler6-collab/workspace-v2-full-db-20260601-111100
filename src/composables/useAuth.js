import { ref, computed } from 'vue'
import { getMe, login, logout, register } from '../api/auth'
import { clearAuthSession, getAuthToken } from '../api/client'

const UI_STYLE_KEY = 'usagi_ui_style'
const DEFAULT_UI_STYLE = 'apple'
const UI_STYLE_DEFAULT_VERSION_KEY = 'usagi_ui_style_default_version'
const UI_STYLE_DEFAULT_VERSION = 'apple-default-20260429'

export function useAuth(AUTH_DISABLED, AUTH_DISABLED_USER, MODULE_DEFINITIONS, ensureActiveModule) {
  // UI Style
  const uiStyles = [
    {
      id: 'violet',
      label: '紫夜',
      hint: '深紫黑底，适合默认运营工作台',
      swatch: 'linear-gradient(135deg, #7c3aed, #00f5d4)'
    },
    {
      id: 'apple',
      label: '银白',
      hint: '白色玻璃质感，偏 Apple 的清爽工作台',
      swatch: 'linear-gradient(135deg, #f5f5f7, #007aff)'
    },
    {
      id: 'usagi',
      label: '乌萨奇',
      hint: '软黄手绘、贴纸感，更像有陪伴感的乌萨奇工作平台',
      swatch: 'linear-gradient(135deg, #fff2b8, #ffd84f 48%, #ff9fb5)'
    }
  ]

  function getInitialUiStyle() {
    try {
      if (localStorage.getItem(UI_STYLE_DEFAULT_VERSION_KEY) !== UI_STYLE_DEFAULT_VERSION) {
        localStorage.setItem(UI_STYLE_KEY, DEFAULT_UI_STYLE)
        localStorage.setItem(UI_STYLE_DEFAULT_VERSION_KEY, UI_STYLE_DEFAULT_VERSION)
        return DEFAULT_UI_STYLE
      }
      const saved = localStorage.getItem(UI_STYLE_KEY)
      if (saved === 'mist') {
        localStorage.setItem(UI_STYLE_KEY, 'apple')
        return 'apple'
      }
      if (uiStyles.some((style) => style.id === saved)) return saved
    } catch(e) {}
    return DEFAULT_UI_STYLE
  }

  const activeUiStyle = ref(getInitialUiStyle())

  function applyUiStyle(styleId) {
    if (typeof document === 'undefined') return
    document.documentElement.dataset.uiStyle = styleId
    window.dispatchEvent(new CustomEvent('usagi:ui-style', { detail: { style: styleId } }))
  }

  function setUiStyle(styleId) {
    if (!uiStyles.some((style) => style.id === styleId)) return
    activeUiStyle.value = styleId
    applyUiStyle(styleId)
    try {
      localStorage.setItem(UI_STYLE_KEY, styleId)
    } catch(e) {}
  }

  applyUiStyle(activeUiStyle.value)

  // Auth State
  const authReady = ref(AUTH_DISABLED)
  const authUser = ref(AUTH_DISABLED ? AUTH_DISABLED_USER : null)
  const loggingIn = ref(false)
  const isLoggedIn = computed(() => !!authUser.value)

  // Login Form
  const authMode = ref('login')
  const loginUser = ref('')
  const loginPass = ref('')
  const loginError = ref('')
  const registerInvite = ref('')
  const registerGroup = ref('')

  // Account Info
  const accountName = computed(() => authUser.value?.display_name || authUser.value?.username || '未登录')
  const accountStatus = computed(() => AUTH_DISABLED ? '免登录测试模式' : (authUser.value?.role === 'admin' ? '管理员' : '成员'))

  function setAuthMode(mode) {
    authMode.value = mode
    loginError.value = ''
  }

  async function doLogin() {
    const username = loginUser.value.trim()
    if (!username || !loginPass.value) {
      loginError.value = '请输入用户名和密码'
      return
    }
    loggingIn.value = true
    loginError.value = ''
    try {
      const data = await login(username, loginPass.value)
      authUser.value = data.user
      loginPass.value = ''
      ensureActiveModule()
    } catch (e) {
      loginError.value = e.message || '登录失败'
    } finally {
      loggingIn.value = false
    }
  }

  async function doRegister() {
    const username = loginUser.value.trim()
    const chineseName = /^[一-龥]{2,12}$/
    if (!chineseName.test(username)) {
      loginError.value = '账号名必须使用 2-20 个中文字符的真名'
      return
    }
    if (!loginPass.value || loginPass.value.length < 6) {
      loginError.value = '密码至少 6 位'
      return
    }
    if (!registerGroup.value.trim()) {
      loginError.value = '请选择所属组别'
      return
    }
    loggingIn.value = true
    loginError.value = ''
    try {
      const data = await register(username, loginPass.value, registerInvite.value.trim(), {
        group_name: registerGroup.value.trim(),
        real_name: username
      })
      authUser.value = data.user
      loginPass.value = ''
      registerInvite.value = ''
      registerGroup.value = ''
      authMode.value = 'login'
      ensureActiveModule()
    } catch (e) {
      loginError.value = e.message || '注册失败'
    } finally {
      loggingIn.value = false
    }
  }

  async function restoreSession() {
    if (AUTH_DISABLED) {
      authUser.value = AUTH_DISABLED_USER
      authReady.value = true
      ensureActiveModule()
      return
    }
    if (!getAuthToken()) {
      authReady.value = true
      return
    }
    try {
      const data = await getMe()
      authUser.value = data.user
      ensureActiveModule()
    } catch (e) {
      clearAuthSession()
    } finally {
      authReady.value = true
    }
  }

  async function handleLogout() {
    if (AUTH_DISABLED) return
    await logout().catch(() => {})
    authUser.value = null
    loginPass.value = ''
  }

  function handleAuthExpired() {
    authUser.value = null
    loginError.value = '登录已过期，请重新登录'
    authReady.value = true
  }

  function submitAuth() {
    if (authMode.value === 'register') {
      doRegister()
      return
    }
    doLogin()
  }

  return {
    // UI Style
    uiStyles,
    activeUiStyle,
    setUiStyle,
    applyUiStyle,
    // Auth State
    authReady,
    authUser,
    authMode,
    loggingIn,
    isLoggedIn,
    // Login Form
    loginUser,
    loginPass,
    loginError,
    registerInvite,
    registerGroup,
    // Account Info
    accountName,
    accountStatus,
    // Methods
    setAuthMode,
    submitAuth,
    doLogin,
    doRegister,
    restoreSession,
    handleLogout,
    handleAuthExpired
  }
}
