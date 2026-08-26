/**
 * Navigation Config
 *
 * HotTake's primary navigation is the bottom tab bar in
 * src/components/Navigation.tsx (TabBar), which is defined against routes
 * directly. This list is kept for the scaffold's role-filtering contract and
 * for any future top-bar links; leaving it empty means the top bar shows only
 * the wordmark and the account menu.
 */

import type { Role } from './constants'

export interface NavItem {
  path: string
  label: string
  roles?: Role[]
  devOnly?: boolean
}

export const nav: NavItem[] = []
