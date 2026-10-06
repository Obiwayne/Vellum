// Which folder under %APPDATA% the app keeps its data in. The important cases: a git checkout (electron.exe) and the real
// installed app (Vellum.exe) share "Vellum"; the installer test product never does; VELLUM_USER_DATA overrides all.
import { describe, expect, it } from 'vitest'
import { userDataDir } from './userDataDir'

const bs = String.fromCharCode(92)
const appData = ['C:', 'Users', 'Obi', 'AppData', 'Roaming'].join(bs)
const exe = (...parts: string[]): string => parts.join(bs)
const base = { env: undefined, hasUserDataSwitch: false, appData }
const folder = (name: string): string => `${appData}${bs}${name}`

describe('userDataDir', () => {
  it('a git checkout runs as electron.exe and keeps "Vellum" (its files are the installed app\'s files)', () => {
    expect(userDataDir({ ...base, isPackaged: false, execPath: exe('F:', 'Vellum', 'node_modules', 'electron', 'dist', 'electron.exe') })).toBe(folder('Vellum'))
  })
  it('the installed Vellum.exe uses "Vellum"', () => {
    expect(userDataDir({ ...base, isPackaged: true, execPath: exe('C:', 'Users', 'Obi', 'AppData', 'Local', 'Programs', 'Vellum', 'Vellum.exe') })).toBe(folder('Vellum'))
  })
  it('the installer test product VellumInstallTest.exe uses its own folder', () => {
    expect(userDataDir({ ...base, isPackaged: true, execPath: exe('C:', 'Temp', 'x', 'app', 'VellumInstallTest.exe') })).toBe(folder('VellumInstallTest'))
  })
  it('any renamed packaged exe uses its own name, including one with spaces or dots', () => {
    expect(userDataDir({ ...base, isPackaged: true, execPath: exe('C:', 'Apps', 'My Vellum', 'Vellum Beta.1.exe') })).toBe(folder('Vellum Beta.1'))
    expect(userDataDir({ ...base, isPackaged: true, execPath: exe('C:', 'Apps', 'vellum.exe') })).toBe(folder('vellum')) // a different folder name, not Vellum
  })
  it('an unpackaged run never takes the exe name, whatever the exe is called', () => {
    expect(userDataDir({ ...base, isPackaged: false, execPath: exe('C:', 'x', 'VellumInstallTest.exe') })).toBe(folder('Vellum'))
  })
  it('VELLUM_USER_DATA overrides everything, packaged or not', () => {
    for (const isPackaged of [true, false]) {
      expect(userDataDir({ ...base, env: exe('D:', 'tmp', 'data'), hasUserDataSwitch: true, isPackaged, execPath: exe('C:', 'x', 'Vellum.exe') })).toBe(exe('D:', 'tmp', 'data'))
    }
  })
  it('--user-data-dir is left to Electron', () => {
    expect(userDataDir({ ...base, hasUserDataSwitch: true, isPackaged: true, execPath: exe('C:', 'x', 'Vellum.exe') })).toBeNull()
  })
})
