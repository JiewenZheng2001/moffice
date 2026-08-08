<script setup lang="ts">
import { ref } from 'vue'
import { login, register, logout, getUsername, AuthError } from '@/services/authService'

const emit = defineEmits<{
  (e: 'authed'): void
}>()

/** 当前登录用户名（null = 未登录） */
const username = ref<string | null>(getUsername())

// 表单状态
const mode = ref<'login' | 'register'>('login')
const formUsername = ref('')
const formPassword = ref('')
const formError = ref('')
const submitting = ref(false)

/** 提交登录/注册 */
async function onSubmit(): Promise<void> {
  if (submitting.value) return
  formError.value = ''
  submitting.value = true
  try {
    const result = mode.value === 'login'
      ? await login(formUsername.value, formPassword.value)
      : await register(formUsername.value, formPassword.value)
    username.value = result.username
    formUsername.value = ''
    formPassword.value = ''
    emit('authed')
  } catch (err) {
    formError.value = err instanceof AuthError ? err.message : String(err)
  } finally {
    submitting.value = false
  }
}

/** 退出登录 */
function onLogout(): void {
  logout()
  username.value = null
  emit('authed')
}
</script>

<template>
  <!-- 已登录：显示用户名 + 退出 -->
  <div v-if="username" class="auth-bar">
    <span class="auth-username">👤 {{ username }}</span>
    <button class="auth-btn" @click="onLogout">退出</button>
  </div>

  <!-- 未登录：登录/注册表单 -->
  <div v-else class="auth-bar">
    <div class="auth-tabs">
      <button
        class="auth-tab"
        :class="{ 'auth-tab--active': mode === 'login' }"
        @click="mode = 'login'; formError = ''"
      >登录</button>
      <button
        class="auth-tab"
        :class="{ 'auth-tab--active': mode === 'register' }"
        @click="mode = 'register'; formError = ''"
      >注册</button>
    </div>
    <input
      v-model="formUsername"
      class="auth-input"
      type="text"
      placeholder="用户名（3-32 字符）"
      @keydown.enter="onSubmit"
    />
    <input
      v-model="formPassword"
      class="auth-input"
      type="password"
      placeholder="密码（至少 6 位）"
      @keydown.enter="onSubmit"
    />
    <button class="auth-btn auth-btn--primary" :disabled="submitting" @click="onSubmit">
      {{ submitting ? '提交中…' : mode === 'login' ? '登录' : '注册' }}
    </button>
    <span v-if="formError" class="auth-error">{{ formError }}</span>
  </div>
</template>

<style scoped>
.auth-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--grid-header-bg);
  border-bottom: 1px solid var(--grid-header-border);
  font-size: 12px;
}

.auth-username {
  color: var(--text-primary);
  margin-right: 4px;
}

.auth-tabs {
  display: flex;
  gap: 2px;
}

.auth-tab {
  border: none;
  background: none;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 2px 8px;
  border-radius: 2px;
}

.auth-tab:hover {
  color: var(--color-primary);
}

.auth-tab--active {
  color: var(--color-primary);
  font-weight: 600;
}

.auth-input {
  height: 22px;
  border: 1px solid var(--grid-cell-border);
  border-radius: 2px;
  padding: 0 6px;
  font-size: 12px;
  background: var(--grid-bg);
  outline: none;
  width: 140px;
}

.auth-input:focus {
  border-color: var(--color-primary);
}

.auth-btn {
  height: 22px;
  border: 1px solid var(--grid-cell-border);
  border-radius: 2px;
  background: var(--grid-bg);
  font-size: 12px;
  color: var(--text-primary);
  cursor: pointer;
  padding: 0 10px;
}

.auth-btn:hover {
  border-color: var(--color-primary);
}

.auth-btn--primary {
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: #fff;
}

.auth-btn--primary:hover {
  background: var(--color-primary-hover);
}

.auth-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.auth-error {
  color: #d03050;
}
</style>
