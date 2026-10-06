// Where the app keeps its data (%APPDATA%\<folder>): decided before the single-instance lock, which lives in that folder.
//  - VELLUM_USER_DATA overrides everything (tests, a second instance).
//  - --user-data-dir on the command line is left to Electron (null).
//  - an installed build uses a folder named after its executable: Vellum.exe -> "Vellum", and the installer test product
//    VellumInstallTest.exe -> "VellumInstallTest", so it can never open the real data even when the installer relaunches it
//    without our environment.
//  - a git checkout runs as electron.exe and keeps "Vellum": its files are the same ones the installed app uses.
import { join, parse } from 'path'

export interface UserDataInput {
  /** process.env.VELLUM_USER_DATA */
  env: string | undefined
  hasUserDataSwitch: boolean
  isPackaged: boolean
  /** process.execPath */
  execPath: string
  /** app.getPath('appData') */
  appData: string
}

export function userDataDir(i: UserDataInput): string | null {
  if (i.env) return i.env
  if (i.hasUserDataSwitch) return null
  return join(i.appData, i.isPackaged ? parse(i.execPath).name : 'Vellum')
}
