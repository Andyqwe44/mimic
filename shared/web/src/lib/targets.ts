// Cross-platform target helpers (peer protocol v2).
import type { TargetDescriptor, TargetKind, WindowInfo } from './types'
import { getHostPlatform } from './platform'

export function windowInfoToTarget(w: WindowInfo): TargetDescriptor {
  if (w.id && w.platform && w.kind) {
    return {
      id: w.id,
      platform: w.platform,
      kind: w.kind,
      title: w.title,
      hwnd: w.hwnd,
      packageName: w.packageName,
      activity: w.activity,
      displayId: w.displayId,
      desktop: w.desktop,
      capabilities: w.capabilities,
    }
  }
  const platform = w.platform ?? (getHostPlatform() === 'android' ? 'android' : 'windows')
  const kind: TargetKind =
    w.kind ??
    (w.category === 'desktop' || w.hwnd === 0
      ? platform === 'android' ? 'display' : 'desktop'
      : w.category === 'process' ? 'process' : 'window')
  const id = w.id ?? (platform === 'windows' ? `hwnd:${w.hwnd}` : `legacy:${w.hwnd}`)
  return {
    id,
    platform,
    kind,
    title: w.title,
    hwnd: w.hwnd,
    packageName: w.packageName,
    activity: w.activity,
    displayId: w.displayId,
    desktop: w.desktop,
    capabilities: w.capabilities,
  }
}

export function targetToWindowInfo(t: TargetDescriptor): WindowInfo {
  return {
    title: t.title,
    category: t.kind === 'display' || t.kind === 'desktop' ? 'desktop' : t.kind === 'process' ? 'process' : 'window',
    hwnd: t.hwnd ?? 0,
    desktop: t.desktop,
    id: t.id,
    platform: t.platform,
    kind: t.kind,
    packageName: t.packageName,
    activity: t.activity,
    displayId: t.displayId,
    capabilities: t.capabilities,
  }
}
